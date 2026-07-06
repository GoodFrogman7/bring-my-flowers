import { vi } from 'vitest';
import { DataStore, RecurringOrderUpdate } from '../src/data/dataStore';
import { MessageSender } from '../src/bot/messageSender';
import {
  Order,
  InventoryItem,
  Delivery,
  DailyLog,
  OrderStatus,
  RecurringOrder,
  ACTIVE_ORDER_STATUSES,
  MessageIntent
} from '../src/types';

/** In-memory DataStore mirroring ExcelManager/GoogleSheetsManager semantics. */
export class InMemoryDataStore implements DataStore {
  orders: Order[] = [];
  inventory: InventoryItem[] = [];
  deliveries: Delivery[] = [];
  dailyLogs: DailyLog[] = [];
  recurring: RecurringOrder[] = [];

  async getAllOrders(): Promise<Order[]> {
    return [...this.orders];
  }

  async getOrderById(orderId: string): Promise<Order | null> {
    return this.orders.find(o => o.order_id === orderId) ?? null;
  }

  async getOrdersByDate(date: string): Promise<Order[]> {
    return this.orders.filter(o => o.date === date);
  }

  async getUpcomingOrderByCustomerPhone(phone: string): Promise<Order | null> {
    const today = new Date().toISOString().split('T')[0];
    const upcoming = this.orders
      .filter(o =>
        o.customer_phone === phone &&
        ACTIVE_ORDER_STATUSES.includes(o.status) &&
        o.date >= today
      )
      .sort((a, b) => a.date.localeCompare(b.date));
    return upcoming[0] ?? null;
  }

  async addOrder(order: Order): Promise<void> {
    this.orders.push(order);
  }

  async updateOrderStatus(orderId: string, status: OrderStatus, notes?: string): Promise<void> {
    const order = this.orders.find(o => o.order_id === orderId);
    if (order) {
      order.status = status;
      if (notes) order.notes = notes;
    }
  }

  async updateOrderDate(orderId: string, newDate: string): Promise<void> {
    const order = this.orders.find(o => o.order_id === orderId);
    if (order) {
      order.date = newDate;
      order.status = 'RESCHEDULED';
    }
  }

  async updateOrderPayment(orderId: string, paymentId: string): Promise<void> {
    const order = this.orders.find(o => o.order_id === orderId);
    if (order) {
      order.payment_id = paymentId;
      order.payment_status = 'PAID';
    }
  }

  async getAllInventory(): Promise<InventoryItem[]> {
    return [...this.inventory];
  }

  async updateInventory(itemName: string, quantityChange: number): Promise<void> {
    const item = this.inventory.find(
      i => i.item_name.toLowerCase() === itemName.toLowerCase()
    );
    if (item) item.quantity += quantityChange;
  }

  async addRecurringOrder(recurringOrder: RecurringOrder): Promise<void> {
    this.recurring.push(recurringOrder);
  }

  async getAllRecurringOrders(): Promise<RecurringOrder[]> {
    return [...this.recurring];
  }

  async getRecurringOrdersByCustomerPhone(phone: string): Promise<RecurringOrder[]> {
    const digits = (s: string) => s.replace(/\D/g, '');
    return this.recurring.filter(r => digits(r.customer_phone) === digits(phone));
  }

  async updateRecurringOrder(recurringId: string, updates: RecurringOrderUpdate): Promise<void> {
    const recurringOrder = this.recurring.find(r => r.recurring_id === recurringId);
    if (recurringOrder) Object.assign(recurringOrder, updates);
  }

  async getDeliveryByOrderId(orderId: string): Promise<Delivery | null> {
    return this.deliveries.find(d => d.order_id === orderId) ?? null;
  }

  async updateDeliveryStatus(deliveryId: string, status: Delivery['status']): Promise<void> {
    const delivery = this.deliveries.find(d => d.delivery_id === deliveryId);
    if (delivery) delivery.status = status;
  }

  async addDailyLog(log: DailyLog): Promise<void> {
    this.dailyLogs.push(log);
  }
}

/** MessageSender that records every outbound message. */
export class FakeSender implements MessageSender {
  sent: Array<{ to: string; message: string }> = [];

  async sendMessage(to: string, message: string): Promise<boolean> {
    this.sent.push({ to, message });
    return true;
  }

  async sendMessageToMultiple(recipients: string[], message: string): Promise<void> {
    for (const recipient of recipients) {
      await this.sendMessage(recipient, message);
    }
  }

  isConnected(): boolean {
    return true;
  }

  lastMessage(): string {
    return this.sent[this.sent.length - 1]?.message ?? '';
  }
}

/**
 * Mocked OllamaClient surface. Defaults are inert; individual tests program
 * classifyMessage / extractOrderDetails per scenario. Cast with
 * `asOllama(fake)` where an OllamaClient is expected.
 */
export function fakeOllama() {
  return {
    classifyMessage: vi.fn(async (_message: string, phone: string) => ({
      intent: MessageIntent.UNKNOWN,
      customer_phone: phone,
      confidence: 0.9
    })),
    extractOrderDetails: vi.fn(async () => ({
      items: [] as Array<{ flowers: string; quantity: number | null }>,
      quantity: null as number | null,
      date: null as string | null
    })),
    generateOrderResponse: vi.fn(async (context: { error?: string }) => `ask:${context.error}`),
    generateOrderConfirmation: vi.fn(async () => 'order confirmed!'),
    generate: vi.fn(async () => 'generated reply'),
    generateDailySummary: vi.fn(async () => 'summary'),
    answerInquiry: vi.fn(async () => 'answer'),
    checkHealth: vi.fn(async () => true)
  };
}

export type FakeOllama = ReturnType<typeof fakeOllama>;

export function rose(overrides: Partial<InventoryItem> = {}): InventoryItem {
  return {
    item_name: 'Roses',
    quantity: 100,
    unit_price: 50,
    cost_price: 30,
    last_updated: '2026-07-01',
    ...overrides
  };
}

export function order(overrides: Partial<Order> = {}): Order {
  return {
    order_id: 'ORD-TEST-1',
    customer_name: 'Customer',
    customer_phone: '+919876543210',
    date: '2099-01-01',
    status: 'CONFIRMED',
    items: 'Roses',
    quantity: 10,
    amount: 500,
    ...overrides
  };
}

export function recurring(overrides: Partial<RecurringOrder> = {}): RecurringOrder {
  return {
    recurring_id: 'REC-TEST-1',
    customer_phone: '+919876543210',
    customer_name: 'Customer',
    items: 'Roses',
    quantity: 10,
    frequency: 'WEEKLY',
    day: 1,
    next_date: '2099-01-01',
    status: 'ACTIVE',
    amount: 500,
    language: 'en',
    ...overrides
  };
}
