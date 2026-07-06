import { MessageSender } from '../bot/messageSender';
import logger from '../utils/logger';
import { Order, Delivery } from '../types';

export class DeliveryNotifier {
  private bot: MessageSender;

  constructor(bot: MessageSender) {
    this.bot = bot;
  }

  async notifyCancellation(order: Order, delivery: Delivery): Promise<boolean> {
    const message = `🚫 Delivery Cancellation Alert

Order ID: ${order.order_id}
Customer: ${order.customer_name}
Phone: ${order.customer_phone}
Items: ${order.items} (${order.quantity} units)
Scheduled Date: ${order.date}

Status: CANCELED
Reason: ${order.notes || 'Customer requested cancellation'}

Please remove this delivery from your schedule.`;

    try {
      const success = await this.bot.sendMessage(delivery.delivery_boy_phone, message);
      
      if (success) {
        logger.info({
          order_id: order.order_id,
          delivery_boy: delivery.delivery_boy,
          delivery_boy_phone: delivery.delivery_boy_phone
        }, 'Cancellation notification sent to delivery boy');
      }
      
      return success;
    } catch (error) {
      logger.error({
        error,
        order_id: order.order_id,
        delivery_boy_phone: delivery.delivery_boy_phone
      }, 'Failed to send cancellation notification');
      return false;
    }
  }

  async notifyReschedule(order: Order, delivery: Delivery, newDate: string): Promise<boolean> {
    const message = `📅 Delivery Rescheduled

Order ID: ${order.order_id}
Customer: ${order.customer_name}
Phone: ${order.customer_phone}
Items: ${order.items} (${order.quantity} units)

Original Date: ${order.date}
New Date: ${newDate}

Please update your delivery schedule accordingly.`;

    try {
      const success = await this.bot.sendMessage(delivery.delivery_boy_phone, message);
      
      if (success) {
        logger.info({
          order_id: order.order_id,
          delivery_boy: delivery.delivery_boy,
          old_date: order.date,
          new_date: newDate
        }, 'Reschedule notification sent to delivery boy');
      }
      
      return success;
    } catch (error) {
      logger.error({
        error,
        order_id: order.order_id,
        delivery_boy_phone: delivery.delivery_boy_phone
      }, 'Failed to send reschedule notification');
      return false;
    }
  }

  async notifyDailyManifest(deliveryBoyPhone: string, deliveryBoyName: string, orders: Order[]): Promise<boolean> {
    if (orders.length === 0) {
      return true; // No deliveries, no need to send
    }

    const ordersList = orders.map((order, index) => 
      `${index + 1}. ${order.customer_name} - ${order.items} (${order.quantity})
   📍 Phone: ${order.customer_phone}
   💰 Amount: ₹${order.amount}`
    ).join('\n\n');

    const totalAmount = orders.reduce((sum, order) => sum + order.amount, 0);

    const message = `📦 Today's Delivery Manifest
Date: ${new Date().toLocaleDateString('en-IN')}
Delivery Boy: ${deliveryBoyName}

Total Deliveries: ${orders.length}
Total Collection: ₹${totalAmount}

Orders:
${ordersList}

Good luck with your deliveries! 🚚`;

    try {
      const success = await this.bot.sendMessage(deliveryBoyPhone, message);
      
      if (success) {
        logger.info({
          delivery_boy: deliveryBoyName,
          delivery_boy_phone: deliveryBoyPhone,
          orders_count: orders.length
        }, 'Daily manifest sent to delivery boy');
      }
      
      return success;
    } catch (error) {
      logger.error({
        error,
        delivery_boy_phone: deliveryBoyPhone
      }, 'Failed to send daily manifest');
      return false;
    }
  }

  async sendCustomMessage(phone: string, message: string): Promise<boolean> {
    try {
      return await this.bot.sendMessage(phone, message);
    } catch (error) {
      logger.error({ error, phone }, 'Failed to send custom message');
      return false;
    }
  }

  async confirmToCustomer(customerPhone: string, action: string, details: string): Promise<boolean> {
    const message = `✅ Confirmation

Action: ${action}
${details}

Thank you for using our service! 🌸`;

    try {
      const success = await this.bot.sendMessage(customerPhone, message);
      
      if (success) {
        logger.info({
          customer_phone: customerPhone,
          action
        }, 'Confirmation sent to customer');
      }
      
      return success;
    } catch (error) {
      logger.error({
        error,
        customer_phone: customerPhone
      }, 'Failed to send confirmation to customer');
      return false;
    }
  }
}

