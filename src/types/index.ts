export interface Config {
  ollama: {
    endpoint: string;
    model: string;
    timeout: number;
  };
  whatsapp: {
    sessionPath: string;
    owners: string[];
    reconnectDelay: number;
    maxReconnectAttempts: number;
  };
  excel: {
    filePath: string;
    backupPath: string;
    backupBeforeWrite: boolean;
  };
  scheduler: {
    summaryTime: string;
    timezone: string;
    /** When recurring orders materialize into real orders (HH:mm, default 07:00) */
    recurringTime?: string;
    /** When customers get "your delivery is today" reminders (HH:mm, default 08:30) */
    reminderTime?: string;
  };
  messaging: {
    confirmationRequired: boolean;
    rateLimitPerMinute: number;
  };
}

export type OrderStatus =
  | 'PENDING'
  | 'PENDING_PAYMENT'
  | 'CONFIRMED'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'CANCELED'
  | 'RESCHEDULED';

/**
 * Order statuses that represent a live, cancellable/reschedulable delivery.
 * OUT_FOR_DELIVERY is deliberately excluded: once flowers leave the shop the
 * customer must call, not self-serve a cancellation.
 */
export const ACTIVE_ORDER_STATUSES: OrderStatus[] = [
  'PENDING',
  'PENDING_PAYMENT',
  'CONFIRMED',
  'RESCHEDULED'
];

/** Statuses for which reserved stock has NOT yet been consumed or returned. */
export const STOCK_HELD_STATUSES: OrderStatus[] = [
  'PENDING',
  'PENDING_PAYMENT',
  'CONFIRMED',
  'RESCHEDULED',
  'OUT_FOR_DELIVERY'
];

export interface Order {
  order_id: string;
  customer_id?: string;
  customer_name: string;
  customer_phone: string;
  /** Delivery date, YYYY-MM-DD */
  date: string;
  status: OrderStatus;
  items: string;
  quantity: number;
  amount: number;
  delivery_boy?: string;
  notes?: string;
  payment_status?: 'PENDING' | 'PAID' | 'REFUNDED';
  payment_id?: string;
  order_date?: string;
  language?: string;
}

export interface InventoryItem {
  item_name: string;
  quantity: number;
  unit_price: number;
  cost_price: number;
  max_stock?: number;
  last_updated: string;
  language_names?: string;
}

export interface Delivery {
  delivery_id: string;
  order_id: string;
  customer_id: string;
  customer_name: string;
  delivery_boy: string;
  delivery_boy_phone: string;
  scheduled_date: string;
  status: 'SCHEDULED' | 'IN_TRANSIT' | 'DELIVERED' | 'CANCELED';
  notes?: string;
}

export interface DailyLog {
  date: string;
  total_orders: number;
  delivered_orders: number;
  canceled_orders: number;
  total_sales: number;
  total_costs: number;
  profit: number;
  notes: string;
}

export type RecurringFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY';
export type RecurringStatus = 'ACTIVE' | 'PAUSED' | 'CANCELLED';

/** A standing order that materializes into a real Order each cycle. */
export interface RecurringOrder {
  /** REC-... */
  recurring_id: string;
  customer_phone: string;
  customer_name: string;
  /** Flower name, exact inventory spelling */
  items: string;
  quantity: number;
  frequency: RecurringFrequency;
  /** WEEKLY: day of week 0-6 (Sunday=0). MONTHLY: day of month 1-28. 0 for DAILY. */
  day: number;
  /** Next delivery date, YYYY-MM-DD */
  next_date: string;
  status: RecurringStatus;
  /** Unit price × quantity at subscription time (informational; cycles reprice) */
  amount: number;
  language?: string;
  created_date?: string;
  notes?: string;
}

export enum MessageIntent {
  NO_DELIVERY = 'NO_DELIVERY',
  RESCHEDULE = 'RESCHEDULE',
  INQUIRY = 'INQUIRY',
  ORDER = 'ORDER',
  RECURRING = 'RECURRING',
  UNKNOWN = 'UNKNOWN'
}

export interface ParsedMessage {
  intent: MessageIntent;
  customer_phone: string;
  customer_name?: string;
  date?: string;
  reason?: string;
  confidence: number;
}

export interface OllamaResponse {
  model: string;
  response: string;
  done: boolean;
}

export interface DailySummary {
  date: string;
  totalOrders: number;
  deliveredOrders: number;
  canceledOrders: number;
  totalRevenue: number;
  totalCosts: number;
  profit: number;
  inventoryUsed: Array<{ item: string; quantity: number }>;
  inventoryRemaining: Array<{ item: string; quantity: number }>;
  report: string;
}

