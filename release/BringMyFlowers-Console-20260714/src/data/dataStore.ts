import { Order, InventoryItem, Delivery, DailyLog, OrderStatus, RecurringOrder } from '../types';

/** Fields of a recurring order the app is allowed to change after creation. */
export type RecurringOrderUpdate = Partial<Pick<RecurringOrder, 'status' | 'next_date' | 'quantity' | 'notes'>>;

/**
 * Storage contract shared by ExcelManager and GoogleSheetsManager.
 * Everything above the data layer (message handling, actions, summaries,
 * webhooks, schedulers) must depend on this interface, never on a concrete
 * store.
 */
export interface DataStore {
  // Orders
  getAllOrders(): Promise<Order[]>;
  getOrderById(orderId: string): Promise<Order | null>;
  /** All orders whose delivery date is exactly `date` (YYYY-MM-DD). */
  getOrdersByDate(date: string): Promise<Order[]>;
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

  // Recurring orders (subscriptions)
  addRecurringOrder(recurring: RecurringOrder): Promise<void>;
  getAllRecurringOrders(): Promise<RecurringOrder[]>;
  getRecurringOrdersByCustomerPhone(phone: string): Promise<RecurringOrder[]>;
  updateRecurringOrder(recurringId: string, updates: RecurringOrderUpdate): Promise<void>;

  // Deliveries (a store may not track these; return null / no-op then)
  getDeliveryByOrderId(orderId: string): Promise<Delivery | null>;
  updateDeliveryStatus(deliveryId: string, status: Delivery['status']): Promise<void>;

  // Daily logs
  addDailyLog(log: DailyLog): Promise<void>;
}
