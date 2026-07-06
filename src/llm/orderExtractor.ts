import { OllamaClient } from './ollama';
import logger from '../utils/logger';

export interface ExtractedOrder {
  items: Array<{
    flower_type: string;
    quantity: number;
    color?: string;
  }>;
  delivery_date?: string;
  special_instructions?: string;
  language: string;
  confidence: number;
}

export class OrderExtractor {
  private ollamaClient: OllamaClient;

  constructor(ollamaClient: OllamaClient) {
    this.ollamaClient = ollamaClient;
  }

  async extractOrderDetails(message: string, detectedLanguage: string): Promise<ExtractedOrder> {
    const systemPrompt = `You are an order extraction AI for a flower delivery service.
Extract order details from customer messages in any language (English, Arabic, Hindi, Urdu).

Return ONLY valid JSON in this exact format:
{
  "items": [
    {"flower_type": "roses", "quantity": 50, "color": "red"},
    {"flower_type": "lilies", "quantity": 30, "color": "white"}
  ],
  "delivery_date": "2026-01-10",
  "special_instructions": "morning delivery",
  "language": "en",
  "confidence": 0.9
}

Flower types: roses, lilies, tulips, carnations, orchids, sunflowers
Colors: red, white, pink, yellow, orange, purple, mixed
Date formats: today, tomorrow, specific date, or leave empty if not mentioned
Confidence: 0.0 to 1.0 based on clarity`;

    const prompt = `Extract order from this message:
"${message}"

Detected language: ${detectedLanguage}

Return JSON only:`;

    try {
      const response = await this.ollamaClient.generate(prompt, systemPrompt);
      
      // Extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        logger.warn({ response }, 'No JSON in order extraction response');
        return this.fallbackExtraction(message, detectedLanguage);
      }

      const extracted = JSON.parse(jsonMatch[0]) as ExtractedOrder;
      extracted.language = detectedLanguage;
      
      logger.info({ extracted, originalMessage: message }, 'Order extracted successfully');
      return extracted;
    } catch (error) {
      logger.error({ error, message }, 'Failed to extract order');
      return this.fallbackExtraction(message, detectedLanguage);
    }
  }

  private fallbackExtraction(message: string, language: string): ExtractedOrder {
    const items: Array<{flower_type: string; quantity: number; color?: string}> = [];
    const lowerMessage = message.toLowerCase();

    // Extract quantities and flower types using regex
    const patterns = [
      /(\d+)\s*(red|white|pink|yellow)?\s*(rose|roses|gulab|ورد|گلاب)/gi,
      /(\d+)\s*(white|pink)?\s*(lil|lilies|lily|زنبق|للی|कुमुदिनी)/gi,
      /(\d+)\s*(red|yellow|pink)?\s*(tulip|tulips|توليب|ट्यूलिप|ٹیولپ)/gi,
    ];

    for (const pattern of patterns) {
      const matches = Array.from(message.matchAll(pattern));
      for (const match of matches) {
        const quantity = parseInt(match[1]);
        const color = match[2] || '';
        let flower_type = 'roses';
        
        if (match[3].match(/lil/i)) flower_type = 'lilies';
        else if (match[3].match(/tulip/i)) flower_type = 'tulips';

        items.push({ flower_type, quantity, color });
      }
    }

    // Extract delivery date
    let delivery_date = '';
    if (lowerMessage.match(/tomorrow|غدا|कल|کل/)) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      delivery_date = tomorrow.toISOString().split('T')[0];
    } else if (lowerMessage.match(/today|اليوم|आज|آج/)) {
      delivery_date = new Date().toISOString().split('T')[0];
    }

    return {
      items,
      delivery_date,
      language,
      confidence: items.length > 0 ? 0.6 : 0.2
    };
  }

  async validateOrder(extracted: ExtractedOrder, inventory: any[]): Promise<{
    valid: boolean;
    issues: string[];
    total_amount: number;
  }> {
    const issues: string[] = [];
    let total_amount = 0;

    for (const item of extracted.items) {
      const inventoryItem = inventory.find(inv => 
        inv.item_name.toLowerCase() === item.flower_type.toLowerCase()
      );

      if (!inventoryItem) {
        issues.push(`${item.flower_type} not available`);
        continue;
      }

      if (inventoryItem.quantity < item.quantity) {
        issues.push(`Only ${inventoryItem.quantity} ${item.flower_type} available, you requested ${item.quantity}`);
      }

      total_amount += inventoryItem.unit_price * item.quantity;
    }

    return {
      valid: issues.length === 0 && extracted.items.length > 0,
      issues,
      total_amount
    };
  }
}
