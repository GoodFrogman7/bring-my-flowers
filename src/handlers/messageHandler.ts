import { OllamaClient } from '../llm/ollama';
import { DataStore } from '../data/dataStore';
import { DeliveryNotifier } from '../notifications/deliveryNotifier';
import { MessageIntent, RecurringOrder } from '../types';
import { cancelDelivery } from './actions/cancelDelivery';
import { rescheduleDelivery } from './actions/rescheduleDelivery';
import { OwnerCommandHandler } from './ownerCommands';
import { findBestFlowerMatch, areFlowerNamesSimilar } from '../utils/fuzzyMatch';
import { OrderSessionStore, OrderDraft, DraftItem, parseQuantity } from '../conversation/orderSession';
import { OrderFulfillment } from './orderFulfillment';
import { LanguageDetector, responses, formatResponse, Language } from '../i18n/languageDetector';
import { parseRecurrence, parseDayOfWeek, nextOccurrence, describeSchedule } from '../utils/recurrence';
import { serializeItems, totalQuantity, displayItems } from '../utils/orderItems';
import { generateOrderId, generateRecurringId } from '../utils/ids';
import logger from '../utils/logger';

export interface MessageHandlerOptions {
  ollamaClient: OllamaClient;
  dataStore: DataStore;
  notifier: DeliveryNotifier;
  /** What to do once an order draft is complete (direct create vs payment link). */
  fulfillment: OrderFulfillment;
  /** When set, messages from owner numbers are routed to the command channel. */
  ownerCommands?: OwnerCommandHandler;
  rateLimitPerMinute?: number;
  /** Ask the customer to confirm the summary before creating the order. */
  confirmationRequired?: boolean;
  sessionTtlMs?: number;
}

const ABORT_PATTERN = /^\s*(cancel|stop|never\s*mind|nevermind|forget\s+it|abort)\b/i;
const YES_PATTERN = /^\s*(y|yes|yeah|yep|sure|ok|okay|confirm|confirmed|haan|ji)\b/i;
const NO_PATTERN = /^\s*(n|no|nope|nah)\b/i;

type RecurringAction = 'pause' | 'resume' | 'cancel' | 'list';

export class MessageHandler {
  private ollamaClient: OllamaClient;
  private dataStore: DataStore;
  private notifier: DeliveryNotifier;
  private fulfillment: OrderFulfillment;
  private ownerCommands?: OwnerCommandHandler;
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
    this.ownerCommands = options.ownerCommands;
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
      // Owners get the command channel, never the customer flow (and no
      // rate limit — a busy morning of commands is legitimate).
      if (this.ownerCommands?.isOwner(from)) {
        await this.ownerCommands.handle(from, message);
        return;
      }

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

      // Deterministic subscription management ("pause my subscription",
      // "cancel REC-…") — money-moving actions must not depend on LLM whims.
      const recurringAction = this.recurringActionFrom(message);
      if (recurringAction) {
        await this.handleRecurringManage(from, message, recurringAction);
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

        case MessageIntent.RECURRING:
          await this.startOrder(from, message, { recurring: true });
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

  private async startOrder(phone: string, message: string, options: { recurring?: boolean } = {}): Promise<void> {
    logger.info({ phone, message, recurring: options.recurring }, 'Starting order conversation');

    const draft: OrderDraft = {
      items: [],
      pendingQuantity: null,
      date: null,
      stage: 'COLLECTING',
      language: this.languageDetector.detectLanguage(message),
      updatedAt: Date.now()
    };

    if (options.recurring) {
      // Cadence from the message, or default to weekly and ask for the day
      draft.recurrence = parseRecurrence(message) ?? { frequency: 'WEEKLY', day: null };
    }

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
    // Recurrence can arrive at any point ("actually make that weekly")
    const recurrence = parseRecurrence(message);
    if (recurrence) {
      draft.recurrence = {
        frequency: recurrence.frequency,
        day: recurrence.day ?? (draft.recurrence?.frequency === recurrence.frequency ? draft.recurrence.day : null)
      };
    }

    const quantitiesComplete = draft.items.length > 0 && draft.items.every(item => item.quantity !== null);

    if (draft.recurrence && draft.recurrence.day === null) {
      if (draft.recurrence.frequency === 'WEEKLY') {
        const day = parseDayOfWeek(message);
        if (day !== null) {
          draft.recurrence.day = day;
          return;
        }
      } else if (draft.recurrence.frequency === 'MONTHLY' && quantitiesComplete) {
        // Quantities are collected first, so a bare number here is the day
        const match = message.trim().match(/^([1-9]|1\d|2[0-8])(st|nd|rd|th)?$/);
        if (match) {
          draft.recurrence.day = parseInt(match[1], 10);
          return;
        }
      }
    }

    const quantity = parseQuantity(message);
    if (quantity !== null) {
      this.applyBareQuantity(draft, quantity);
      return;
    }

    try {
      const extracted = await this.ollamaClient.extractOrderDetails(message);
      const addedThisMessage = new Set<DraftItem>();
      for (const entry of extracted.items) {
        const existing = draft.items.find(item => areFlowerNamesSimilar(item.name, entry.flowers));
        if (existing) {
          if (entry.quantity) {
            // Duplicates within one message add up ("5 roses and 3 more
            // roses"); a re-mention in a later message is a correction.
            existing.quantity = addedThisMessage.has(existing)
              ? (existing.quantity ?? 0) + entry.quantity
              : entry.quantity;
          }
        } else {
          const itemQuantity = entry.quantity ?? draft.pendingQuantity;
          if (entry.quantity === null && draft.pendingQuantity !== null) draft.pendingQuantity = null;
          const newItem: DraftItem = { name: entry.flowers, quantity: itemQuantity };
          draft.items.push(newItem);
          addedThisMessage.add(newItem);
        }
      }
      if (extracted.quantity) {
        this.applyBareQuantity(draft, extracted.quantity);
      }
      // Subscriptions have a schedule, not a one-off date
      if (!draft.recurrence && extracted.date) {
        draft.date = extracted.date;
      }
    } catch (error) {
      logger.warn({ error, message }, 'Order extraction failed; keeping current draft');
    }
  }

  /**
   * A quantity with no flower attached goes to the first item still missing
   * one; with a single fully-specified item it's a correction ("make it 5");
   * before any flower is named it's held until one arrives.
   */
  private applyBareQuantity(draft: OrderDraft, quantity: number): void {
    const target = draft.items.find(item => item.quantity === null)
      ?? (draft.items.length === 1 ? draft.items[0] : undefined);
    if (target) {
      target.quantity = quantity;
    } else if (draft.items.length === 0) {
      draft.pendingQuantity = quantity;
    }
    // Several items, all quantified: an unattributed number is ambiguous — ignore it
  }

  /**
   * Ask for the first missing slot, or confirm/fulfill when complete.
   * Every "ask" saves the session so the customer's next message continues here.
   */
  private async advanceOrder(phone: string, message: string, draft: OrderDraft): Promise<void> {
    const inventory = await this.dataStore.getAllInventory();
    const availableFlowers = inventory.map(item => item.item_name);

    if (draft.items.length === 0) {
      await this.askAndSave(phone, message, draft, {
        availableFlowers,
        error: draft.pendingQuantity ? 'missing_flower' : 'missing_all'
      });
      return;
    }

    // Resolve every requested name to an exact inventory item
    for (const item of draft.items) {
      const flowerMatch = findBestFlowerMatch(item.name, availableFlowers);
      if (!flowerMatch || flowerMatch.confidence < 0.6) {
        logger.warn({ searchTerm: item.name, availableFlowers }, 'No fuzzy match found');
        const unmatched = item.name;
        draft.items = draft.items.filter(other => other !== item);
        await this.askAndSave(phone, message, draft, {
          availableFlowers,
          error: 'no_match',
          requestedFlower: unmatched
        });
        return;
      }
      item.name = flowerMatch.match;
    }

    // Merge duplicate mentions of the same flower by summing quantities
    const merged: DraftItem[] = [];
    for (const item of draft.items) {
      const existing = merged.find(other => other.name === item.name);
      if (!existing) {
        merged.push(item);
      } else if (item.quantity !== null) {
        existing.quantity = (existing.quantity ?? 0) + item.quantity;
      }
    }
    draft.items = merged;

    const flowerByName = new Map(inventory.map(item => [item.item_name, item]));

    const unquantified = draft.items.find(item => item.quantity === null);
    if (unquantified) {
      const flower = flowerByName.get(unquantified.name)!;
      await this.askAndSave(phone, message, draft, {
        matchedFlower: flower.item_name,
        flowerPrice: flower.unit_price,
        flowerStock: flower.quantity,
        error: 'missing_quantity'
      });
      return;
    }

    const lineItems = draft.items.map(item => ({
      flower: flowerByName.get(item.name)!,
      quantity: item.quantity!
    }));
    const totalPrice = lineItems.reduce((sum, line) => sum + line.quantity * line.flower.unit_price, 0);
    const itemsDescription = serializeItems(lineItems.map(line => ({ name: line.flower.item_name, quantity: line.quantity })));

    // Subscription drafts: collect the delivery day, confirm, create. Stock
    // is checked per cycle by the scheduler, not frozen at signup.
    if (draft.recurrence) {
      if (draft.recurrence.day === null) {
        draft.stage = 'COLLECTING';
        this.orderSessions.set(phone, draft);
        const question = draft.recurrence.frequency === 'MONTHLY'
          ? 'Which day of the month should we deliver? (1-28)'
          : `Which day should we deliver ${itemsDescription} every week? (e.g. Monday)`;
        await this.notifier.sendCustomMessage(phone, question);
        return;
      }

      if (draft.stage !== 'AWAITING_CONFIRMATION') {
        draft.stage = 'AWAITING_CONFIRMATION';
        this.orderSessions.set(phone, draft);
        await this.notifier.sendCustomMessage(
          phone,
          `Here's your subscription:\n\n${itemsDescription} ${describeSchedule(draft.recurrence.frequency, draft.recurrence.day)} — ₹${totalPrice} per delivery\n\nReply YES to confirm or NO to cancel.`
        );
        return;
      }

      this.orderSessions.clear(phone);
      await this.createSubscription(phone, draft, totalPrice);
      return;
    }

    // One-off orders: every line must be in stock right now
    for (const line of lineItems) {
      if (line.flower.quantity < line.quantity) {
        logger.warn({
          requested: line.quantity,
          available: line.flower.quantity,
          flower: line.flower.item_name
        }, 'Insufficient stock');
        const draftItem = draft.items.find(item => item.name === line.flower.item_name)!;
        draftItem.quantity = null;
        await this.askAndSave(phone, message, draft, {
          matchedFlower: line.flower.item_name,
          flowerStock: line.flower.quantity,
          requestedQuantity: line.quantity,
          error: 'low_stock'
        });
        return;
      }
    }

    if (!draft.date) {
      await this.askAndSave(phone, message, draft, {
        matchedFlower: draft.items[0].name,
        error: 'missing_date'
      });
      return;
    }

    if (this.confirmationRequired && draft.stage !== 'AWAITING_CONFIRMATION') {
      draft.stage = 'AWAITING_CONFIRMATION';
      this.orderSessions.set(phone, draft);
      const lines = lineItems
        .map(line => `${line.quantity} ${line.flower.item_name} — ₹${line.quantity * line.flower.unit_price}`)
        .join('\n');
      await this.notifier.sendCustomMessage(
        phone,
        `Here's your order:\n\n${lines}\nTotal: ₹${totalPrice}\nDelivery: ${draft.date}\n\nReply YES to confirm or NO to cancel.`
      );
      return;
    }

    // Clear the session before fulfilling so a fulfillment error can't leave
    // the customer stuck mid-conversation.
    this.orderSessions.clear(phone);
    await this.fulfillment.fulfill({
      phone,
      orderId: generateOrderId(),
      items: lineItems,
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
      requestedQuantity?: number;
      error: string;
      requestedFlower?: string | null;
    }
  ): Promise<void> {
    draft.stage = 'COLLECTING';
    this.orderSessions.set(phone, draft);

    const response = await this.ollamaClient.generateOrderResponse({
      customerMessage: message,
      extractedDetails: {
        flowers: context.requestedFlower ?? (draft.items.map(item => item.name).join(', ') || null),
        quantity: context.requestedQuantity ?? draft.pendingQuantity,
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

  // ---- Subscriptions ---------------------------------------------------------

  private async createSubscription(
    phone: string,
    draft: OrderDraft,
    amountPerDelivery: number
  ): Promise<void> {
    const spec = draft.recurrence!;
    const day = spec.day ?? 0;
    const today = new Date().toISOString().split('T')[0];
    const firstDate = nextOccurrence(spec.frequency, day, today);
    const specs = draft.items.map(item => ({ name: item.name, quantity: item.quantity! }));
    const itemsDescription = serializeItems(specs);

    const recurring: RecurringOrder = {
      recurring_id: generateRecurringId(),
      customer_phone: phone,
      customer_name: `Customer ${phone.slice(-4)}`,
      items: itemsDescription,
      quantity: totalQuantity(specs),
      frequency: spec.frequency,
      day,
      next_date: firstDate,
      status: 'ACTIVE',
      amount: amountPerDelivery,
      language: draft.language,
      created_date: new Date().toISOString()
    };

    await this.dataStore.addRecurringOrder(recurring);

    await this.notifier.sendCustomMessage(
      phone,
      formatResponse(responses.recurring_created[draft.language], {
        items: itemsDescription,
        schedule: describeSchedule(spec.frequency, day),
        amount: amountPerDelivery,
        date: firstDate
      })
    );

    logger.info({
      recurring_id: recurring.recurring_id,
      phone,
      items: itemsDescription,
      frequency: spec.frequency,
      first_date: firstDate
    }, 'Subscription created');
  }

  /**
   * Detect subscription management requests deterministically. Only fires
   * when the message names a subscription (or a REC- id) — plain "cancel my
   * order" still goes through intent classification.
   */
  private recurringActionFrom(message: string): RecurringAction | null {
    const text = message.toLowerCase();
    if (!/subscri(be|ption)|recurring|standing\s+order|\brec-/.test(text)) return null;

    if (/\bpause\b|\bhold\b/.test(text)) return 'pause';
    if (/\bresume\b|\brestart\b|\bunpause\b|\bcontinue\b/.test(text)) return 'resume';
    if (/\bcancel\b|\bstop\b|\bend\b|\bunsubscribe\b/.test(text)) return 'cancel';
    if (/\bstatus\b|\blist\b|\bshow\b|\bwhat\b|\bmy\s+subscriptions?\s*$/.test(text)) return 'list';
    return null;
  }

  private async handleRecurringManage(phone: string, message: string, action: RecurringAction): Promise<void> {
    const language: Language = this.languageDetector.detectLanguage(message);
    const subscriptions = (await this.dataStore.getRecurringOrdersByCustomerPhone(phone))
      .filter(r => r.status !== 'CANCELLED');

    const describe = (r: RecurringOrder) =>
      `${r.recurring_id}: ${displayItems(r.items, r.quantity)} ${describeSchedule(r.frequency, r.day)} (${r.status}, next ${r.next_date})`;

    if (action === 'list') {
      await this.notifier.sendCustomMessage(
        phone,
        subscriptions.length === 0
          ? "You don't have any subscriptions yet. Want one? Just tell me, e.g. \"10 roses every Monday\"."
          : `Your subscriptions:\n\n${subscriptions.map(describe).join('\n')}`
      );
      return;
    }

    if (subscriptions.length === 0) {
      await this.notifier.sendCustomMessage(
        phone,
        "You don't have an active subscription. To start one, just tell me, e.g. \"10 roses every Monday\"."
      );
      return;
    }

    const idInMessage = message.toUpperCase().match(/\bREC-[A-Z0-9-]+\b/)?.[0];
    let target = idInMessage
      ? subscriptions.find(r => r.recurring_id === idInMessage)
      : subscriptions.length === 1 ? subscriptions[0] : undefined;

    if (idInMessage && !target) {
      await this.notifier.sendCustomMessage(
        phone,
        `I couldn't find ${idInMessage}. Your subscriptions:\n\n${subscriptions.map(describe).join('\n')}`
      );
      return;
    }

    if (!target) {
      await this.notifier.sendCustomMessage(
        phone,
        `You have ${subscriptions.length} subscriptions — which one?\n\n${subscriptions.map(describe).join('\n')}\n\nReply e.g. "${action} ${subscriptions[0].recurring_id}".`
      );
      return;
    }

    const lang = (target.language as Language) || language;
    const recurringId = target.recurring_id;

    if (action === 'pause') {
      if (target.status !== 'ACTIVE') {
        await this.notifier.sendCustomMessage(phone, `${recurringId} is already paused.`);
        return;
      }
      await this.dataStore.updateRecurringOrder(recurringId, { status: 'PAUSED' });
      await this.notifier.sendCustomMessage(
        phone,
        formatResponse(responses.recurring_paused[lang], { recurringId })
      );
      return;
    }

    if (action === 'resume') {
      if (target.status !== 'PAUSED') {
        await this.notifier.sendCustomMessage(phone, `${recurringId} is already active.`);
        return;
      }
      // Recompute from today so a long pause doesn't dump missed cycles
      const nextDate = nextOccurrence(target.frequency, target.day, new Date().toISOString().split('T')[0]);
      await this.dataStore.updateRecurringOrder(recurringId, { status: 'ACTIVE', next_date: nextDate });
      await this.notifier.sendCustomMessage(
        phone,
        formatResponse(responses.recurring_resumed[lang], { recurringId, date: nextDate })
      );
      return;
    }

    // cancel
    await this.dataStore.updateRecurringOrder(recurringId, { status: 'CANCELLED' });
    await this.notifier.sendCustomMessage(
      phone,
      formatResponse(responses.recurring_cancelled[lang], { recurringId })
    );
    logger.info({ recurring_id: recurringId, phone }, 'Subscription cancelled by customer');
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
