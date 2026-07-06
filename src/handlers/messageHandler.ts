import { OllamaClient } from '../llm/ollama';
import { DataStore } from '../data/dataStore';
import { DeliveryNotifier } from '../notifications/deliveryNotifier';
import { MessageIntent } from '../types';
import { cancelDelivery } from './actions/cancelDelivery';
import { rescheduleDelivery } from './actions/rescheduleDelivery';
import { findBestFlowerMatch } from '../utils/fuzzyMatch';
import { OrderSessionStore, OrderDraft, parseQuantity } from '../conversation/orderSession';
import { OrderFulfillment } from './orderFulfillment';
import { LanguageDetector } from '../i18n/languageDetector';
import logger from '../utils/logger';

export interface MessageHandlerOptions {
  ollamaClient: OllamaClient;
  dataStore: DataStore;
  notifier: DeliveryNotifier;
  /** What to do once an order draft is complete (direct create vs payment link). */
  fulfillment: OrderFulfillment;
  rateLimitPerMinute?: number;
  /** Ask the customer to confirm the summary before creating the order. */
  confirmationRequired?: boolean;
  sessionTtlMs?: number;
}

const ABORT_PATTERN = /^\s*(cancel|stop|never\s*mind|nevermind|forget\s+it|abort)\b/i;
const YES_PATTERN = /^\s*(y|yes|yeah|yep|sure|ok|okay|confirm|confirmed|haan|ji)\b/i;
const NO_PATTERN = /^\s*(n|no|nope|nah)\b/i;

function generateOrderId(): string {
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `ORD-${Date.now().toString(36).toUpperCase()}-${rand}`;
}

export class MessageHandler {
  private ollamaClient: OllamaClient;
  private dataStore: DataStore;
  private notifier: DeliveryNotifier;
  private fulfillment: OrderFulfillment;
  private confirmationRequired: boolean;
  private orderSessions: OrderSessionStore;
  private languageDetector: LanguageDetector = new LanguageDetector();
  private rateLimitMap: Map<string, number[]> = new Map();
  private rateLimitPerMinute: number;

  constructor(options: MessageHandlerOptions) {
    this.ollamaClient = options.ollamaClient;
    this.dataStore = options.dataStore;
    this.notifier = options.notifier;
    this.fulfillment = options.fulfillment;
    this.confirmationRequired = options.confirmationRequired ?? false;
    this.orderSessions = new OrderSessionStore(options.sessionTtlMs);
    this.rateLimitPerMinute = options.rateLimitPerMinute ?? 20;
  }

  private checkRateLimit(phone: string): boolean {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    const timestamps = (this.rateLimitMap.get(phone) || []).filter(t => t > oneMinuteAgo);

    if (timestamps.length >= this.rateLimitPerMinute) {
      logger.warn({ phone, attempts: timestamps.length }, 'Rate limit exceeded');
      return false;
    }

    timestamps.push(now);
    this.rateLimitMap.set(phone, timestamps);
    return true;
  }

  async handleMessage(from: string, message: string): Promise<void> {
    try {
      if (!this.checkRateLimit(from)) {
        await this.notifier.sendCustomMessage(
          from,
          "You're sending messages too quickly. Please wait a moment and try again."
        );
        return;
      }

      logger.info({ from, message }, 'Processing message');

      // An in-flight order draft takes priority: follow-up answers like "10"
      // or "tomorrow" belong to it, not to fresh intent classification.
      const session = this.orderSessions.get(from);
      if (session) {
        if (ABORT_PATTERN.test(message)) {
          this.orderSessions.clear(from);
          await this.notifier.sendCustomMessage(
            from,
            "No problem — I've cleared that order request. Anything else I can help with?"
          );
          return;
        }
        await this.continueOrder(from, message, session);
        return;
      }

      const parsed = await this.ollamaClient.classifyMessage(message, from);

      logger.info({
        from,
        intent: parsed.intent,
        confidence: parsed.confidence
      }, 'Message classified');

      switch (parsed.intent) {
        case MessageIntent.NO_DELIVERY:
          await this.handleCancellation(from, parsed.reason);
          break;

        case MessageIntent.RESCHEDULE:
          await this.handleReschedule(from, parsed.date || '');
          break;

        case MessageIntent.INQUIRY:
          await this.handleInquiry(from, message);
          break;

        case MessageIntent.ORDER:
          await this.startOrder(from, message);
          break;

        case MessageIntent.UNKNOWN:
        default:
          await this.handleUnknown(from, message);
          break;
      }
    } catch (error) {
      logger.error({ error, from, message }, 'Error handling message');
      // Drop any half-collected draft: the store may be in an unknown state.
      this.orderSessions.clear(from);
      await this.notifier.sendCustomMessage(
        from,
        "Sorry, I encountered an error processing your message. Please try again or contact us directly."
      );
    }
  }

  private async handleCancellation(phone: string, reason?: string): Promise<void> {
    logger.info({ phone, reason }, 'Handling cancellation request');
    const result = await cancelDelivery(phone, this.dataStore, this.notifier, reason);

    if (!result.success) {
      logger.warn({ phone, message: result.message }, 'Cancellation failed');
      await this.notifier.sendCustomMessage(phone, result.message);
    }
  }

  private async handleReschedule(phone: string, newDate: string): Promise<void> {
    if (!newDate) {
      await this.notifier.sendCustomMessage(
        phone,
        "I understand you want to reschedule. Could you please specify the new date? For example: 'Deliver on January 5' or 'Change to tomorrow'"
      );
      return;
    }

    logger.info({ phone, new_date: newDate }, 'Handling reschedule request');
    const result = await rescheduleDelivery(phone, newDate, this.dataStore, this.notifier);

    if (!result.success) {
      logger.warn({ phone, message: result.message }, 'Reschedule failed');
      await this.notifier.sendCustomMessage(phone, result.message);
    }
  }

  private async handleInquiry(phone: string, question: string): Promise<void> {
    logger.info({ phone, question }, 'Handling inquiry');

    try {
      const inventory = await this.dataStore.getAllInventory();
      const availableFlowers = inventory.map(i => `${i.item_name} (₹${i.unit_price}/stem, ${i.quantity} available)`).join('\n');

      const systemPrompt = `You are a knowledgeable flower shop assistant.
Be helpful, natural, and concise. Under 60 words.
Today: ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}`;

      const prompt = `Customer asked: "${question}"

Available inventory:
${availableFlowers}

Answer their question naturally and helpfully.`;

      const response = await this.ollamaClient.generate(prompt, systemPrompt);
      await this.notifier.sendCustomMessage(phone, response);
    } catch (error) {
      logger.error({ error, question }, 'AI inquiry handling failed');
      await this.notifier.sendCustomMessage(phone, "I'm here to help! What would you like to know?");
    }
  }

  // ---- Order pipeline ------------------------------------------------------

  private async startOrder(phone: string, message: string): Promise<void> {
    logger.info({ phone, message }, 'Starting order conversation');

    const draft: OrderDraft = {
      flowers: null,
      quantity: null,
      date: null,
      stage: 'COLLECTING',
      language: this.languageDetector.detectLanguage(message),
      updatedAt: Date.now()
    };

    await this.applyExtraction(draft, message);
    await this.advanceOrder(phone, message, draft);
  }

  private async continueOrder(phone: string, message: string, draft: OrderDraft): Promise<void> {
    logger.info({ phone, message, draft }, 'Continuing order conversation');

    if (draft.stage === 'AWAITING_CONFIRMATION') {
      if (YES_PATTERN.test(message)) {
        await this.advanceOrder(phone, message, draft);
        return;
      }
      if (NO_PATTERN.test(message)) {
        this.orderSessions.clear(phone);
        await this.notifier.sendCustomMessage(
          phone,
          "Okay, I've cancelled that order request. Let me know if you'd like anything else."
        );
        return;
      }
      // Anything else is treated as a correction ("make it 5 instead").
      draft.stage = 'COLLECTING';
    }

    await this.applyExtraction(draft, message);
    await this.advanceOrder(phone, message, draft);
  }

  /**
   * Merge whatever this message tells us into the draft. Cheap local parses
   * first (a bare "10" needs no LLM); otherwise LLM extraction, whose failure
   * is non-fatal — we just re-ask for whatever is still missing.
   */
  private async applyExtraction(draft: OrderDraft, message: string): Promise<void> {
    const quantity = parseQuantity(message);
    if (quantity !== null) {
      draft.quantity = quantity;
      return;
    }

    try {
      const extracted = await this.ollamaClient.extractOrderDetails(message);
      if (extracted.flowers) draft.flowers = extracted.flowers;
      if (extracted.quantity && extracted.quantity > 0) draft.quantity = extracted.quantity;
      if (extracted.date && /^\d{4}-\d{2}-\d{2}$/.test(extracted.date)) draft.date = extracted.date;
    } catch (error) {
      logger.warn({ error, message }, 'Order extraction failed; keeping current draft');
    }
  }

  /**
   * Ask for the first missing slot, or confirm/fulfill when complete.
   * Every "ask" saves the session so the customer's next message continues here.
   */
  private async advanceOrder(phone: string, message: string, draft: OrderDraft): Promise<void> {
    const inventory = await this.dataStore.getAllInventory();
    const availableFlowers = inventory.map(item => item.item_name);

    if (!draft.flowers) {
      await this.askAndSave(phone, message, draft, {
        availableFlowers,
        error: draft.quantity ? 'missing_flower' : 'missing_all'
      });
      return;
    }

    const flowerMatch = findBestFlowerMatch(draft.flowers, availableFlowers);
    if (!flowerMatch || flowerMatch.confidence < 0.6) {
      logger.warn({ searchTerm: draft.flowers, availableFlowers }, 'No fuzzy match found');
      const unmatched = draft.flowers;
      draft.flowers = null;
      await this.askAndSave(phone, message, draft, {
        availableFlowers,
        error: 'no_match',
        requestedFlower: unmatched
      });
      return;
    }

    const matchedFlower = inventory.find(item => item.item_name === flowerMatch.match)!;
    draft.flowers = matchedFlower.item_name;

    if (!draft.quantity) {
      await this.askAndSave(phone, message, draft, {
        matchedFlower: matchedFlower.item_name,
        flowerPrice: matchedFlower.unit_price,
        flowerStock: matchedFlower.quantity,
        error: 'missing_quantity'
      });
      return;
    }

    if (matchedFlower.quantity < draft.quantity) {
      logger.warn({
        requested: draft.quantity,
        available: matchedFlower.quantity,
        flower: matchedFlower.item_name
      }, 'Insufficient stock');
      draft.quantity = null;
      await this.askAndSave(phone, message, draft, {
        matchedFlower: matchedFlower.item_name,
        flowerStock: matchedFlower.quantity,
        error: 'low_stock'
      });
      return;
    }

    if (!draft.date) {
      await this.askAndSave(phone, message, draft, {
        matchedFlower: matchedFlower.item_name,
        flowerPrice: matchedFlower.unit_price,
        error: 'missing_date'
      });
      return;
    }

    const totalPrice = draft.quantity * matchedFlower.unit_price;

    if (this.confirmationRequired && draft.stage !== 'AWAITING_CONFIRMATION') {
      draft.stage = 'AWAITING_CONFIRMATION';
      this.orderSessions.set(phone, draft);
      await this.notifier.sendCustomMessage(
        phone,
        `Here's your order:\n\n${draft.quantity} ${matchedFlower.item_name} — ₹${totalPrice}\nDelivery: ${draft.date}\n\nReply YES to confirm or NO to cancel.`
      );
      return;
    }

    // Clear the session before fulfilling so a fulfillment error can't leave
    // the customer stuck mid-conversation.
    this.orderSessions.clear(phone);
    await this.fulfillment.fulfill({
      phone,
      orderId: generateOrderId(),
      flower: matchedFlower,
      quantity: draft.quantity,
      deliveryDate: draft.date,
      totalPrice,
      language: draft.language
    });
  }

  private async askAndSave(
    phone: string,
    message: string,
    draft: OrderDraft,
    context: {
      availableFlowers?: string[];
      matchedFlower?: string;
      flowerPrice?: number;
      flowerStock?: number;
      error: string;
      requestedFlower?: string | null;
    }
  ): Promise<void> {
    draft.stage = 'COLLECTING';
    this.orderSessions.set(phone, draft);

    const response = await this.ollamaClient.generateOrderResponse({
      customerMessage: message,
      extractedDetails: {
        flowers: context.requestedFlower ?? draft.flowers,
        quantity: draft.quantity,
        date: draft.date
      },
      availableFlowers: context.availableFlowers,
      matchedFlower: context.matchedFlower,
      flowerPrice: context.flowerPrice,
      flowerStock: context.flowerStock,
      error: context.error
    });
    await this.notifier.sendCustomMessage(phone, response);
  }

  // ---- Fallback ------------------------------------------------------------

  private async handleUnknown(phone: string, message: string): Promise<void> {
    logger.info({ phone, message }, 'Handling unknown intent');

    try {
      const inventory = await this.dataStore.getAllInventory();
      const flowerList = inventory.map(i => i.item_name).join(', ');

      const systemPrompt = `You are a friendly, professional flower shop assistant for "Bring My Flowers".
We sell: ${flowerList || 'Roses, Lilies, Tulips'}
Services: Order flowers, cancel/reschedule deliveries, check order status

Be warm, natural, and helpful. Keep responses under 40 words.
Today: ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}`;

      const prompt = `Customer said: "${message}"

Respond naturally and helpfully.`;

      const response = await this.ollamaClient.generate(prompt, systemPrompt);
      await this.notifier.sendCustomMessage(phone, response);
    } catch (error) {
      logger.error({ error, phone, message }, 'Failed to generate AI response');
      await this.notifier.sendCustomMessage(
        phone,
        "I'd love to help! What can I do for you today?"
      );
    }
  }
}
