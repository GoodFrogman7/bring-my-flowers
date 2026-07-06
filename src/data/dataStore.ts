import { Order, InventoryItem, Delivery, DailyLog, OrderStatus } from '../types';

/**
 * Storage contract shared by ExcelManager and GoogleSheetsManager.
 * Everything above the data layer (message handling, actions, summaries,
 * webhooks) must depend on this interface, never on a concrete store.
 */
export interface DataStore {
  // Orders
  getAllOrders(): Promise<Order[]>;
  /**
   * Earliest active (PENDING/PENDING_PAYMENT/CONFIRMED/RESCHEDULED) order for
   * this customer with a delivery date of today or later.
   */
  getUpcomingOrderByCustomerPhone(phone: string): Promise<Order | null>;
  addOrder(order: Order): Promise<void>;
  updateOrderStatus(orderId: string, status: OrderStatus, notes?: string): Promise<void>;
  updateOrderDate(orderId: string, newDate: string): Promise<void>;
  updateOrderPayment(orderId: string, paymentId: string): Promise<void>;

  // Inventory
  getAllInventory(): Promise<InventoryItem[]>;
  updateInventory(itemName: string, quantityChange: number): Promise<void>;

  // Deliveries (a store may not track these; return null / no-op then)
  getDeliveryByOrderId(orderId: string): Promise<Delivery | null>;
  updateDeliveryStatus(deliveryId: string, status: Delivery['status']): Promise<void>;

  // Daily logs
  addDailyLog(log: DailyLog): Promise<void>;
}
