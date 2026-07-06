import fetch from 'node-fetch';
import logger from '../utils/logger';
import { MessageIntent, ParsedMessage, OllamaResponse } from '../types';

export class OllamaClient {
  private endpoint: string;
  private model: string;
  private timeout: number;

  constructor(endpoint: string, model: string, timeout: number = 60000) {
    this.endpoint = endpoint;
    this.model = model;
    this.timeout = timeout;  // Increased to 60 seconds for better reliability
  }

  async generate(prompt: string, systemPrompt?: string, options?: { json?: boolean }): Promise<string> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(`${this.endpoint}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          prompt: prompt,
          system: systemPrompt,
          stream: false,
          // Ollama's native JSON mode constrains decoding to valid JSON —
          // far more reliable than scraping JSON out of prose with a regex.
          ...(options?.json ? { format: 'json' } : {})
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.statusText}`);
      }

      const data = await response.json() as OllamaResponse;
      return data.response.trim();
    } catch (error) {
      logger.error({ error, endpoint: this.endpoint }, 'Ollama generate failed');
      throw error;
    }
  }

  /**
   * Parse a JSON-mode response; falls back to extracting the first JSON
   * object from prose for models/endpoints that ignore format constraints.
   */
  private parseJsonResponse<T>(response: string): T {
    try {
      return JSON.parse(response) as T;
    } catch {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }
      return JSON.parse(jsonMatch[0]) as T;
    }
  }

  /**
   * Enhanced date extraction with better natural language understanding
   */
  async extractOrderDetails(message: string): Promise<{
    flowers: string | null;
    quantity: number | null;
    date: string | null;
    rawDate?: string;
  }> {
    const systemPrompt = `You are an expert at extracting structured data from natural language.
Today's date is ${new Date().toISOString().split('T')[0]} (${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}).

Extract flower order details and return ONLY valid JSON. Be smart about:
- Spelling variations (lillies = lilies, rozes = roses)
- Date formats (2nd february 2026, Feb 2, tomorrow, next week)
- Quantities (5, five, a dozen = 12)

Convert dates to YYYY-MM-DD format.`;

    const prompt = `Message: "${message}"

Extract:
{
  "flowers": "flower type or null",
  "quantity": number or null,
  "date": "YYYY-MM-DD or null"
}

Examples:
- "I want 5 lillies" → {"flowers": "lilies", "quantity": 5, "date": null}
- "Send me roses for tomorrow" → {"flowers": "roses", "quantity": null, "date": "2026-01-11"}
- "3 tulips on 2nd february 2026" → {"flowers": "tulips", "quantity": 3, "date": "2026-02-02"}

Return ONLY JSON:`;

    try {
      const response = await this.generate(prompt, systemPrompt, { json: true });
      logger.info({ response, message }, 'Ollama order extraction response');

      const extracted = this.parseJsonResponse<{
        flowers?: string | null;
        quantity?: number | null;
        date?: string | null;
      }>(response);
      return {
        flowers: extracted.flowers || null,
        quantity: extracted.quantity || null,
        date: extracted.date || null
      };
    } catch (error) {
      logger.error({ error, message }, 'Failed to extract order details');
      throw error;
    }
  }

  /**
   * Generate a conversational response for order processing
   */
  async generateOrderResponse(context: {
    customerMessage: string;
    extractedDetails: any;
    availableFlowers?: string[];
    matchedFlower?: string;
    flowerPrice?: number;
    flowerStock?: number;
    error?: string;
  }): Promise<string> {
    const systemPrompt = `You are a professional flower shop assistant. 
Be brief, friendly, and natural. Keep responses under 40 words.
Today's date: ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`;

    let prompt = '';

    if (context.error === 'no_match') {
      prompt = `Customer asked for: "${context.extractedDetails.flowers}"
We don't have that.
Available: ${context.availableFlowers?.join(', ') || 'Roses, Lilies, Tulips'}

Ask naturally which one they'd like instead.`;
    } else if (context.error === 'low_stock') {
      prompt = `Customer wants: ${context.extractedDetails.quantity} ${context.matchedFlower}
Only have: ${context.flowerStock} in stock

Ask naturally if they want the ${context.flowerStock} we have.`;
    } else if (context.error === 'missing_quantity') {
      prompt = `Customer wants: ${context.extractedDetails.flowers || context.matchedFlower}
Didn't mention quantity.

Ask naturally how many they'd like.`;
    } else if (context.error === 'missing_date') {
      prompt = `Customer wants: ${context.extractedDetails.quantity} ${context.matchedFlower}
No delivery date mentioned.

Ask naturally when they want delivery.`;
    } else {
      prompt = `Customer said: "${context.customerMessage}"

Respond naturally and helpfully.`;
    }

    try {
      return await this.generate(prompt, systemPrompt);
    } catch (error) {
      logger.error({ error, context }, 'AI generation failed');
      // Ultra-minimal fallback only if AI completely fails
      if (context.error === 'missing_date') {
        return "When would you like delivery?";
      }
      if (context.error === 'missing_quantity') {
        return "How many would you like?";
      }
      return "How can I help you with your order?";
    }
  }

  /**
   * Generate order confirmation message
   */
  async generateOrderConfirmation(orderDetails: {
    orderId: string;
    flowers: string;
    quantity: number;
    price: number;
    deliveryDate: string;
  }): Promise<string> {
    const systemPrompt = `You are confirming a flower order. Be warm, clear, and concise.
Include all details. Keep under 50 words.`;

    const deliveryDateFormatted = new Date(orderDetails.deliveryDate).toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric', 
      year: 'numeric' 
    });

    const prompt = `Confirm this order naturally:
- Order ID: ${orderDetails.orderId}
- Flowers: ${orderDetails.quantity} ${orderDetails.flowers}
- Price: ₹${orderDetails.price}
- Delivery: ${deliveryDateFormatted}

Write a friendly, natural confirmation with all these details.`;

    try {
      return await this.generate(prompt, systemPrompt);
    } catch (error) {
      // Fallback only if AI completely fails
      return `✅ Order Confirmed!

Order ID: ${orderDetails.orderId}
${orderDetails.quantity} ${orderDetails.flowers}
Price: ₹${orderDetails.price}
Delivery: ${deliveryDateFormatted}

Thank you! 🌸`;
    }
  }

  async classifyMessage(message: string, customerPhone: string): Promise<ParsedMessage> {
    const systemPrompt = `You are a message classifier for a flower delivery business.
Analyze customer messages and extract key information.
Respond ONLY with valid JSON in this exact format:
{
  "intent": "NO_DELIVERY" | "RESCHEDULE" | "INQUIRY" | "ORDER" | "RECURRING" | "UNKNOWN",
  "customer_phone": "phone number",
  "customer_name": "name if mentioned",
  "date": "date if mentioned in YYYY-MM-DD format",
  "reason": "reason if provided",
  "confidence": 0.0 to 1.0
}`;

    const prompt = `Message: "${message}"
Customer Phone: ${customerPhone}

Classify this message and extract information. Common phrases:
- "no delivery", "cancel", "don't deliver" → NO_DELIVERY
- "deliver tomorrow", "change to", "reschedule" → RESCHEDULE
- "status", "when", "do you have" → INQUIRY
- "I want", "order", "send me" (one-off) → ORDER
- "every week", "every Monday", "daily", "monthly", "subscription", "standing order" → RECURRING
- anything mentioning a subscription (pause/cancel/resume it) → RECURRING

Return JSON only:`;

    try {
      const response = await this.generate(prompt, systemPrompt, { json: true });

      const parsed = this.parseJsonResponse<ParsedMessage>(response);

      // Validate and set defaults
      if (!parsed.intent || !Object.values(MessageIntent).includes(parsed.intent)) {
        parsed.intent = this.detectIntentFallback(message);
      }
      
      parsed.customer_phone = customerPhone;
      parsed.confidence = parsed.confidence || 0.5;

      logger.info({ parsed, originalMessage: message }, 'Message classified');
      return parsed;
    } catch (error) {
      logger.error({ error, message }, 'Failed to classify message');
      return this.createFallbackParsedMessage(message, customerPhone);
    }
  }

  private detectIntentFallback(message: string): MessageIntent {
    const lowerMessage = message.toLowerCase();

    // Subscription-specific words win even over cancellation phrasing:
    // "cancel my subscription" must not cancel a single order.
    if (lowerMessage.match(/subscri(be|ption)|recurring|standing\s+order|\brec-/i)) {
      return MessageIntent.RECURRING;
    }

    // IMPORTANT: Check cancellation patterns FIRST (most specific)
    if (lowerMessage.match(/no\s+delivery|cancel.*delivery|don'?t\s+(want|need).*delivery|skip\s+today|cancel.*order/i)) {
      return MessageIntent.NO_DELIVERY;
    }

    // Recurrence cadence ("every monday", "weekly", "daily") → subscription
    if (lowerMessage.match(/\bevery\s+(day|week|month|sun|mon|tue|wed|thu|fri|sat)|\bdaily\b|\bweekly\b|\bmonthly\b/i)) {
      return MessageIntent.RECURRING;
    }

    // Check reschedule patterns
    if (lowerMessage.match(/reschedule|change.*date|deliver\s+(on|tomorrow|next)/i)) {
      return MessageIntent.RESCHEDULE;
    }
    
    // Check inquiry patterns
    if (lowerMessage.match(/status|when\s+(will|is)|where\s+is|do\s+you\s+have|available|what.*time/i)) {
      return MessageIntent.INQUIRY;
    }
    
    // Check order patterns (LAST - least specific)
    if (lowerMessage.match(/(?:^|\s)(i\s+)?want|need|order|send\s+me/i)) {
      return MessageIntent.ORDER;
    }
    
    return MessageIntent.UNKNOWN;
  }

  private createFallbackParsedMessage(message: string, customerPhone: string): ParsedMessage {
    return {
      intent: this.detectIntentFallback(message),
      customer_phone: customerPhone,
      confidence: 0.3
    };
  }

  async generateDailySummary(data: {
    totalOrders: number;
    deliveredOrders: number;
    canceledOrders: number;
    totalRevenue: number;
    totalCosts: number;
    profit: number;
    inventoryUsed: Array<{ item: string; quantity: number }>;
    inventoryRemaining: Array<{ item: string; quantity: number }>;
    date: string;
  }): Promise<string> {
    const systemPrompt = `You are a business analyst. Generate a concise, friendly daily business summary for flower shop owners. 
Use emojis where appropriate. Keep it under 200 words. Focus on key metrics and insights.`;

    const prompt = `Generate a daily business summary for ${data.date}:

Orders: ${data.totalOrders} total (${data.deliveredOrders} delivered, ${data.canceledOrders} canceled)
Revenue: ₹${data.totalRevenue.toFixed(2)}
Costs: ₹${data.totalCosts.toFixed(2)}
Profit: ₹${data.profit.toFixed(2)}

Inventory Used Today:
${data.inventoryUsed.map(i => `- ${i.item}: ${i.quantity} units`).join('\n')}

Remaining Stock:
${data.inventoryRemaining.map(i => `- ${i.item}: ${i.quantity} units`).join('\n')}

Create a friendly summary with insights and recommendations:`;

    try {
      const summary = await this.generate(prompt, systemPrompt);
      logger.info({ date: data.date }, 'Daily summary generated');
      return summary;
    } catch (error) {
      logger.error({ error }, 'Failed to generate daily summary');
      // Return a basic summary if Ollama fails
      return this.generateBasicSummary(data);
    }
  }

  private generateBasicSummary(data: any): string {
    return `📊 Daily Business Summary - ${data.date}

Orders: ${data.totalOrders} total (${data.deliveredOrders} delivered, ${data.canceledOrders} canceled)
Revenue: ₹${data.totalRevenue.toFixed(2)}
Costs: ₹${data.totalCosts.toFixed(2)}
Profit: ₹${data.profit.toFixed(2)} ${data.profit > 0 ? '💰' : '📉'}

Inventory Used:
${data.inventoryUsed.map((i: any) => `- ${i.item}: ${i.quantity} units`).join('\n')}

Remaining Stock:
${data.inventoryRemaining.map((i: any) => `- ${i.item}: ${i.quantity} units`).join('\n')}`;
  }

  async answerInquiry(question: string, context: string = ''): Promise<string> {
    const systemPrompt = `You are a helpful customer service assistant for a flower delivery business.
Answer questions politely and concisely. If you don't know something, say so.
Keep responses under 100 words.`;

    const prompt = `Customer Question: ${question}
${context ? `Context: ${context}` : ''}

Provide a helpful response:`;

    try {
      const answer = await this.generate(prompt, systemPrompt);
      return answer;
    } catch (error) {
      logger.error({ error, question }, 'Failed to answer inquiry');
      return "I apologize, but I'm having trouble processing your question right now. Please try again or contact us directly.";
    }
  }

  async checkHealth(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${this.endpoint}/api/tags`, {
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      return response.ok;
    } catch (error) {
      logger.error({ error, endpoint: this.endpoint }, 'Ollama health check failed');
      return false;
    }
  }
}
