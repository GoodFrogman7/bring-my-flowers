import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import * as lockfile from 'proper-lockfile';
import logger from '../utils/logger';
import { Order, InventoryItem, Delivery, DailyLog, RecurringOrder, ACTIVE_ORDER_STATUSES } from '../types';
import { DataStore, RecurringOrderUpdate } from './dataStore';
import { samePhone } from '../utils/ids';

const RECURRING_HEADERS = [
  'recurring_id', 'customer_phone', 'customer_name', 'items', 'quantity',
  'frequency', 'day', 'next_date', 'status', 'amount', 'language', 'created_date', 'notes'
];

export class ExcelManager implements DataStore {
  private filePath: string;
  private backupPath: string;
  private backupBeforeWrite: boolean;

  constructor(filePath: string, backupPath: string, backupBeforeWrite: boolean = true) {
    this.filePath = filePath;
    this.backupPath = backupPath;
    this.backupBeforeWrite = backupBeforeWrite;
    this.initializeFile();
  }

  private initializeFile(): void {
    if (!fs.existsSync(this.filePath)) {
      logger.info({ filePath: this.filePath }, 'Creating new Excel file');
      const workbook = XLSX.utils.book_new();

      // Orders sheet
      const ordersData = [
        ['order_id', 'customer_id', 'customer_name', 'customer_phone', 'date', 'status', 'items', 'quantity', 'amount', 'delivery_boy', 'notes']
      ];
      const ordersSheet = XLSX.utils.aoa_to_sheet(ordersData);
      XLSX.utils.book_append_sheet(workbook, ordersSheet, 'Orders');

      // Inventory sheet
      const inventoryData = [
        ['item_name', 'quantity', 'unit_price', 'cost_price', 'last_updated'],
        ['Roses', 100, 50, 30, new Date().toISOString()],
        ['Lilies', 60, 60, 35, new Date().toISOString()],
        ['Tulips', 40, 45, 25, new Date().toISOString()]
      ];
      const inventorySheet = XLSX.utils.aoa_to_sheet(inventoryData);
      XLSX.utils.book_append_sheet(workbook, inventorySheet, 'Inventory');

      // Deliveries sheet
      const deliveriesData = [
        ['delivery_id', 'order_id', 'customer_id', 'customer_name', 'delivery_boy', 'delivery_boy_phone', 'scheduled_date', 'status', 'notes']
      ];
      const deliveriesSheet = XLSX.utils.aoa_to_sheet(deliveriesData);
      XLSX.utils.book_append_sheet(workbook, deliveriesSheet, 'Deliveries');

      // Daily Logs sheet
      const logsData = [
        ['date', 'total_orders', 'delivered_orders', 'canceled_orders', 'total_sales', 'total_costs', 'profit', 'notes']
      ];
      const logsSheet = XLSX.utils.aoa_to_sheet(logsData);
      XLSX.utils.book_append_sheet(workbook, logsSheet, 'Daily_Logs');

      // Recurring orders sheet
      const recurringSheet = XLSX.utils.aoa_to_sheet([RECURRING_HEADERS]);
      XLSX.utils.book_append_sheet(workbook, recurringSheet, 'Recurring_Orders');

      XLSX.writeFile(workbook, this.filePath);
      logger.info({ filePath: this.filePath }, 'Excel file initialized');
    }
  }

  private backupFile(): void {
    if (!this.backupBeforeWrite || !fs.existsSync(this.filePath)) return;

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupFilePath = path.join(
      this.backupPath,
      `business_data_${timestamp}.xlsx`
    );

    fs.copyFileSync(this.filePath, backupFilePath);
    logger.debug({ backupFilePath }, 'Backup created');

    // Keep only last 10 backups
    this.cleanOldBackups();
  }

  private cleanOldBackups(): void {
    if (!fs.existsSync(this.backupPath)) return;

    const files = fs.readdirSync(this.backupPath)
      .filter(f => f.startsWith('business_data_') && f.endsWith('.xlsx'))
      .map(f => ({
        name: f,
        path: path.join(this.backupPath, f),
        time: fs.statSync(path.join(this.backupPath, f)).mtime.getTime()
      }))
      .sort((a, b) => b.time - a.time);

    // Delete backups beyond the 10 most recent
    files.slice(10).forEach(file => {
      fs.unlinkSync(file.path);
      logger.debug({ file: file.name }, 'Old backup deleted');
    });
  }

  private async withFileLock<T>(operation: () => T): Promise<T> {
    let release: (() => Promise<void>) | null = null;
    try {
      release = await lockfile.lock(this.filePath, { retries: 5 });
      return operation();
    } finally {
      if (release) await release();
    }
  }

  // All writes go through here so the backup is taken under the same lock
  // that guards the read-modify-write cycle.
  private async withLockedWrite<T>(operation: () => T): Promise<T> {
    return this.withFileLock(() => {
      this.backupFile();
      return operation();
    });
  }

  private readWorkbook(): XLSX.WorkBook {
    if (!fs.existsSync(this.filePath)) {
      this.initializeFile();
    }
    return XLSX.readFile(this.filePath);
  }

  private writeWorkbook(workbook: XLSX.WorkBook): void {
    XLSX.writeFile(workbook, this.filePath);
  }

  // Orders CRUD
  async getAllOrders(): Promise<Order[]> {
    return this.withFileLock(() => {
      const workbook = this.readWorkbook();
      const sheet = workbook.Sheets['Orders'];
      if (!sheet) return [];
      const data = XLSX.utils.sheet_to_json<Order>(sheet);
      return data;
    });
  }

  async getTodayOrders(): Promise<Order[]> {
    const today = new Date().toISOString().split('T')[0];
    return this.getOrdersByDate(today);
  }

  async getOrderById(orderId: string): Promise<Order | null> {
    const orders = await this.getAllOrders();
    return orders.find(o => o.order_id === orderId) || null;
  }

  async getOrdersByDate(date: string): Promise<Order[]> {
    const allOrders = await this.getAllOrders();
    return allOrders.filter(order => order.date === date);
  }

  async getUpcomingOrderByCustomerPhone(phone: string): Promise<Order | null> {
    const today = new Date().toISOString().split('T')[0];
    const orders = await this.getAllOrders();
    const upcoming = orders
      .filter(o =>
        o.customer_phone === phone &&
        o.date >= today &&
        ACTIVE_ORDER_STATUSES.includes(o.status)
      )
      .sort((a, b) => a.date.localeCompare(b.date));
    return upcoming[0] || null;
  }

  async addOrder(order: Order): Promise<void> {
    return this.withLockedWrite(() => {
      const workbook = this.readWorkbook();
      const sheet = workbook.Sheets['Orders'];
      const data = XLSX.utils.sheet_to_json<Order>(sheet);
      data.push(order);
      const newSheet = XLSX.utils.json_to_sheet(data);
      workbook.Sheets['Orders'] = newSheet;
      this.writeWorkbook(workbook);
      logger.info({ order_id: order.order_id }, 'Order added');
    });
  }

  async updateOrderStatus(orderId: string, status: Order['status'], notes?: string): Promise<void> {
    return this.withLockedWrite(() => {
      const workbook = this.readWorkbook();
      const sheet = workbook.Sheets['Orders'];
      const data = XLSX.utils.sheet_to_json<Order>(sheet);
      const order = data.find(o => o.order_id === orderId);
      if (order) {
        order.status = status;
        if (notes) order.notes = notes;
        const newSheet = XLSX.utils.json_to_sheet(data);
        workbook.Sheets['Orders'] = newSheet;
        this.writeWorkbook(workbook);
        logger.info({ order_id: orderId, status }, 'Order status updated');
      }
    });
  }

  async updateOrderDate(orderId: string, newDate: string): Promise<void> {
    return this.withLockedWrite(() => {
      const workbook = this.readWorkbook();
      const sheet = workbook.Sheets['Orders'];
      const data = XLSX.utils.sheet_to_json<Order>(sheet);
      const order = data.find(o => o.order_id === orderId);
      if (order) {
        order.date = newDate;
        workbook.Sheets['Orders'] = XLSX.utils.json_to_sheet(data);
        this.writeWorkbook(workbook);
        logger.info({ order_id: orderId, new_date: newDate }, 'Order date updated');
      }
    });
  }

  async updateOrderPayment(orderId: string, paymentId: string): Promise<void> {
    return this.withLockedWrite(() => {
      const workbook = this.readWorkbook();
      const sheet = workbook.Sheets['Orders'];
      const data = XLSX.utils.sheet_to_json<Order>(sheet);
      const order = data.find(o => o.order_id === orderId);
      if (order) {
        order.payment_status = 'PAID';
        order.payment_id = paymentId;
        workbook.Sheets['Orders'] = XLSX.utils.json_to_sheet(data);
        this.writeWorkbook(workbook);
        logger.info({ order_id: orderId, payment_id: paymentId }, 'Order payment updated');
      }
    });
  }

  // Inventory CRUD
  async getAllInventory(): Promise<InventoryItem[]> {
    return this.withFileLock(() => {
      const workbook = this.readWorkbook();
      const sheet = workbook.Sheets['Inventory'];
      if (!sheet) return [];
      return XLSX.utils.sheet_to_json<InventoryItem>(sheet);
    });
  }

  async getInventoryItem(itemName: string): Promise<InventoryItem | null> {
    const inventory = await this.getAllInventory();
    return inventory.find(item => item.item_name.toLowerCase() === itemName.toLowerCase()) || null;
  }

  async updateInventory(itemName: string, quantityChange: number): Promise<void> {
    return this.withLockedWrite(() => {
      const workbook = this.readWorkbook();
      const sheet = workbook.Sheets['Inventory'];
      const data = XLSX.utils.sheet_to_json<InventoryItem>(sheet);
      const item = data.find(i => i.item_name.toLowerCase() === itemName.toLowerCase());
      
      if (item) {
        item.quantity += quantityChange;
        item.last_updated = new Date().toISOString();
        const newSheet = XLSX.utils.json_to_sheet(data);
        workbook.Sheets['Inventory'] = newSheet;
        this.writeWorkbook(workbook);
        logger.info({ item_name: itemName, quantity_change: quantityChange, new_quantity: item.quantity }, 'Inventory updated');
      } else {
        logger.warn({ item_name: itemName }, 'Inventory item not found');
      }
    });
  }

  async addInventoryItem(item: InventoryItem): Promise<void> {
    return this.withLockedWrite(() => {
      const workbook = this.readWorkbook();
      const sheet = workbook.Sheets['Inventory'];
      const data = XLSX.utils.sheet_to_json<InventoryItem>(sheet);
      data.push(item);
      const newSheet = XLSX.utils.json_to_sheet(data);
      workbook.Sheets['Inventory'] = newSheet;
      this.writeWorkbook(workbook);
      logger.info({ item_name: item.item_name }, 'Inventory item added');
    });
  }

  // Recurring orders CRUD. Workbooks created before this feature lack the
  // sheet, so reads tolerate its absence and writes create it on demand.
  private recurringSheet(workbook: XLSX.WorkBook): XLSX.WorkSheet {
    if (!workbook.Sheets['Recurring_Orders']) {
      const sheet = XLSX.utils.aoa_to_sheet([RECURRING_HEADERS]);
      XLSX.utils.book_append_sheet(workbook, sheet, 'Recurring_Orders');
    }
    return workbook.Sheets['Recurring_Orders'];
  }

  async getAllRecurringOrders(): Promise<RecurringOrder[]> {
    return this.withFileLock(() => {
      const workbook = this.readWorkbook();
      const sheet = workbook.Sheets['Recurring_Orders'];
      if (!sheet) return [];
      return XLSX.utils.sheet_to_json<RecurringOrder>(sheet);
    });
  }

  async getRecurringOrdersByCustomerPhone(phone: string): Promise<RecurringOrder[]> {
    const all = await this.getAllRecurringOrders();
    return all.filter(r => samePhone(r.customer_phone, phone));
  }

  async addRecurringOrder(recurring: RecurringOrder): Promise<void> {
    return this.withLockedWrite(() => {
      const workbook = this.readWorkbook();
      const sheet = this.recurringSheet(workbook);
      const data = XLSX.utils.sheet_to_json<RecurringOrder>(sheet);
      data.push(recurring);
      workbook.Sheets['Recurring_Orders'] = XLSX.utils.json_to_sheet(data, { header: RECURRING_HEADERS });
      this.writeWorkbook(workbook);
      logger.info({ recurring_id: recurring.recurring_id }, 'Recurring order added');
    });
  }

  async updateRecurringOrder(recurringId: string, updates: RecurringOrderUpdate): Promise<void> {
    return this.withLockedWrite(() => {
      const workbook = this.readWorkbook();
      const sheet = this.recurringSheet(workbook);
      const data = XLSX.utils.sheet_to_json<RecurringOrder>(sheet);
      const recurring = data.find(r => r.recurring_id === recurringId);
      if (!recurring) {
        logger.warn({ recurring_id: recurringId }, 'Recurring order not found');
        return;
      }
      Object.assign(recurring, updates);
      workbook.Sheets['Recurring_Orders'] = XLSX.utils.json_to_sheet(data, { header: RECURRING_HEADERS });
      this.writeWorkbook(workbook);
      logger.info({ recurring_id: recurringId, updates }, 'Recurring order updated');
    });
  }

  // Deliveries CRUD
  async getAllDeliveries(): Promise<Delivery[]> {
    return this.withFileLock(() => {
      const workbook = this.readWorkbook();
      const sheet = workbook.Sheets['Deliveries'];
      if (!sheet) return [];
      return XLSX.utils.sheet_to_json<Delivery>(sheet);
    });
  }

  async getDeliveryByOrderId(orderId: string): Promise<Delivery | null> {
    const deliveries = await this.getAllDeliveries();
    return deliveries.find(d => d.order_id === orderId) || null;
  }

  async addDelivery(delivery: Delivery): Promise<void> {
    return this.withLockedWrite(() => {
      const workbook = this.readWorkbook();
      const sheet = workbook.Sheets['Deliveries'];
      const data = XLSX.utils.sheet_to_json<Delivery>(sheet);
      data.push(delivery);
      const newSheet = XLSX.utils.json_to_sheet(data);
      workbook.Sheets['Deliveries'] = newSheet;
      this.writeWorkbook(workbook);
      logger.info({ delivery_id: delivery.delivery_id }, 'Delivery added');
    });
  }

  async updateDeliveryStatus(deliveryId: string, status: Delivery['status']): Promise<void> {
    return this.withLockedWrite(() => {
      const workbook = this.readWorkbook();
      const sheet = workbook.Sheets['Deliveries'];
      const data = XLSX.utils.sheet_to_json<Delivery>(sheet);
      const delivery = data.find(d => d.delivery_id === deliveryId);
      if (delivery) {
        delivery.status = status;
        const newSheet = XLSX.utils.json_to_sheet(data);
        workbook.Sheets['Deliveries'] = newSheet;
        this.writeWorkbook(workbook);
        logger.info({ delivery_id: deliveryId, status }, 'Delivery status updated');
      }
    });
  }

  // Daily Logs
  async addDailyLog(log: DailyLog): Promise<void> {
    return this.withLockedWrite(() => {
      const workbook = this.readWorkbook();
      const sheet = workbook.Sheets['Daily_Logs'];
      const data = XLSX.utils.sheet_to_json<DailyLog>(sheet);
      data.push(log);
      const newSheet = XLSX.utils.json_to_sheet(data);
      workbook.Sheets['Daily_Logs'] = newSheet;
      this.writeWorkbook(workbook);
      logger.info({ date: log.date }, 'Daily log added');
    });
  }

  async getDailyLog(date: string): Promise<DailyLog | null> {
    return this.withFileLock(() => {
      const workbook = this.readWorkbook();
      const sheet = workbook.Sheets['Daily_Logs'];
      if (!sheet) return null;
      const data = XLSX.utils.sheet_to_json<DailyLog>(sheet);
      return data.find(log => log.date === date) || null;
    });
  }
}

