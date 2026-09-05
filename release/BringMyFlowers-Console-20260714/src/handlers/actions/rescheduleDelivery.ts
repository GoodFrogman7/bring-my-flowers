import { DataStore } from '../../data/dataStore';
import { DeliveryNotifier } from '../../notifications/deliveryNotifier';
import logger from '../../utils/logger';

export async function rescheduleDelivery(
  customerPhone: string,
  newDate: string,
  dataStore: DataStore,
  notifier: DeliveryNotifier
): Promise<{ success: boolean; message: string }> {
  try {
    // Find the customer's next upcoming active order (today or later)
    const order = await dataStore.getUpcomingOrderByCustomerPhone(customerPhone);

    if (!order) {
      logger.warn({ customer_phone: customerPhone }, 'No active order found for rescheduling');
      return {
        success: false,
        message: "Sorry, I couldn't find any upcoming delivery for you to reschedule."
      };
    }

    const oldDate = order.date;

    // Move the delivery to the new date and record the change
    await dataStore.updateOrderDate(order.order_id, newDate);
    await dataStore.updateOrderStatus(order.order_id, 'RESCHEDULED', `Rescheduled from ${oldDate} to ${newDate}`);

    // Find and notify delivery boy
    const delivery = await dataStore.getDeliveryByOrderId(order.order_id);
    if (delivery) {
      await notifier.notifyReschedule(order, delivery, newDate);
    }

    // Send confirmation to customer
    const confirmationDetails = `Your delivery has been rescheduled.
Order ID: ${order.order_id}
Items: ${order.items}
Original Date: ${oldDate}
New Date: ${newDate}

We'll deliver on the new date. Thank you for your patience!`;

    await notifier.confirmToCustomer(customerPhone, 'Delivery Rescheduled', confirmationDetails);

    logger.info({
      order_id: order.order_id,
      customer_phone: customerPhone,
      old_date: oldDate,
      new_date: newDate
    }, 'Delivery rescheduled successfully');

    return {
      success: true,
      message: `Your delivery has been rescheduled to ${newDate}. Order ID: ${order.order_id}`
    };
  } catch (error) {
    logger.error({ error, customer_phone: customerPhone, new_date: newDate }, 'Failed to reschedule delivery');
    return {
      success: false,
      message: "Sorry, there was an error rescheduling your delivery. Please contact us directly."
    };
  }
}
