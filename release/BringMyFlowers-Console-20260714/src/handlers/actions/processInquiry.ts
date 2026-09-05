import { OllamaClient } from '../../llm/ollama';
import { DataStore } from '../../data/dataStore';
import { DeliveryNotifier } from '../../notifications/deliveryNotifier';
import logger from '../../utils/logger';

export async function processInquiry(
  customerPhone: string,
  question: string,
  ollamaClient: OllamaClient,
  dataStore: DataStore,
  notifier: DeliveryNotifier
): Promise<{ success: boolean; message: string }> {
  try {
    // Build context from customer's order if exists
    let context = '';
    const order = await dataStore.getUpcomingOrderByCustomerPhone(customerPhone);

    if (order) {
      context = `Customer has an active order:
Order ID: ${order.order_id}
Items: ${order.items}
Quantity: ${order.quantity}
Amount: ₹${order.amount}
Status: ${order.status}
Delivery Date: ${order.date}`;
    }

    // Check if asking about inventory
    const inventory = await dataStore.getAllInventory();
    context += `\n\nAvailable items:\n${inventory.map(i => `- ${i.item_name}: ${i.quantity} units at ₹${i.unit_price} each`).join('\n')}`;

    // Get answer from Ollama
    const answer = await ollamaClient.answerInquiry(question, context);

    // Send answer to customer
    await notifier.sendCustomMessage(customerPhone, answer);

    logger.info({
      customer_phone: customerPhone,
      question,
      answer
    }, 'Inquiry processed');

    return {
      success: true,
      message: answer
    };
  } catch (error) {
    logger.error({ error, customer_phone: customerPhone, question }, 'Failed to process inquiry');
    
    const fallbackMessage = "Thank you for your inquiry. Our team will get back to you shortly. For urgent matters, please call us directly.";
    await notifier.sendCustomMessage(customerPhone, fallbackMessage);
    
    return {
      success: false,
      message: fallbackMessage
    };
  }
}

