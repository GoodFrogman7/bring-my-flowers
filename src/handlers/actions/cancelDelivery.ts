import { DataStore } from '../../data/dataStore';
import { DeliveryNotifier } from '../../notifications/deliveryNotifier';
import { parseItems } from '../../utils/orderItems';
import logger from '../../utils/logger';

export async function cancelDelivery(
  customerPhone: string,
  dataStore: DataStore,
  notifier: DeliveryNotifier,
  reason?: string
): Promise<{ success: boolean; message: string }> {
  try {
    // Find the customer's next upcoming active order (today or later)
    const order = await dataStore.getUpcomingOrderByCustomerPhone(customerPhone);

    if (!order) {
      logger.warn({ customer_phone: customerPhone }, 'No active order found for cancellation');
      return {
        success: false,
        message: "Sorry, I couldn't find any upcoming delivery for you. If you have an order, please contact us directly."
      };
    }

    // Update order status
    const notes = reason || 'Customer requested cancellation';
    await dataStore.updateOrderStatus(order.order_id, 'CANCELED', notes);

    // Return each line item to inventory ("5 Roses, 3 Lilies"; legacy rows
    // hold a bare name with the count in the quantity column)
    for (const item of parseItems(order.items, order.quantity)) {
      await dataStore.updateInventory(item.name, item.quantity);
    }

    // Find and update delivery
    const delivery = await dataStore.getDeliveryByOrderId(order.order_id);
    if (delivery) {
      await dataStore.updateDeliveryStatus(delivery.delivery_id, 'CANCELED');
      
      // Notify delivery boy
      await notifier.notifyCancellation(order, delivery);
    }

    // Send confirmation to customer
    const confirmationDetails = `Your delivery for ${order.date} has been canceled.
Order ID: ${order.order_id}
Items: ${order.items}
Amount: ₹${order.amount}

${reason ? `Reason: ${reason}` : ''}`;

    await notifier.confirmToCustomer(customerPhone, 'Delivery Canceled', confirmationDetails);

    logger.info({
      order_id: order.order_id,
      customer_phone: customerPhone,
      reason: notes
    }, 'Delivery canceled successfully');

    return {
      success: true,
      message: `Your delivery has been canceled successfully. Order ID: ${order.order_id}`
    };
  } catch (error) {
    logger.error({ error, customer_phone: customerPhone }, 'Failed to cancel delivery');
    return {
      success: false,
      message: "Sorry, there was an error processing your cancellation. Please contact us directly."
    };
  }
}

