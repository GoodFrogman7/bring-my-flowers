import { google } from 'googleapis';
import logger from '../utils/logger';
import { Order, InventoryItem, Delivery, DailyLog, OrderStatus, ACTIVE_ORDER_STATUSES } from '../types';
import { DataStore } from './dataStore';

export class GoogleSheetsManager implements DataStore {
  private sheets: any;
  private spreadsheetId: string;
  private auth: any;

  constructor(credentialsPath: string, spreadsheetId: string) {
    this.spreadsheetId = spreadsheetId;
    this.initializeAuth(credentialsPath);
  }

  private async initializeAuth(credentialsPath: string) {
    try {
      const auth = new google.auth.GoogleAuth({
        keyFile: credentialsPath,
        scopes: [
          'https://www.googleapis.com/auth/spreadsheets',
          'https://www.googleapis.com/auth/calendar'
        ],
      });
      this.auth = await auth.getClient();
      this.sheets = google.sheets({ version: 'v4', auth: this.auth });
      logger.info('Google Sheets authenticated successfully');
    } catch (error) {
      logger.error({ error }, 'Failed to initialize Google Sheets auth');
      throw error;
    }
  }

  // Inventory Operations
  async getAllInventory(): Promise<InventoryItem[]> {
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'Inventory!A2:H',
      });

      const rows = response.data.values || [];
      return rows.map((row: any[]) => ({
        item_name: row[0] || '',
        quantity: parseInt(row[1]) || 0,
        unit_price: parseFloat(row[2]) || 0,
        cost_price: parseFloat(row[3]) || 0,
        max_stock: parseInt(row[4]) || 100,
        last_updated: row[5] || new Date().toISOString(),
        language_names: row[6] || ''
      }));
    } catch (error) {
      logger.error({ error }, 'Failed to get inventory');
      return [];
    }
  }

  async updateInventory(itemName: string, quantityChange: number): Promise<void> {
    try {
      const inventory = await this.getAllInventory();
      const itemIndex = inventory.findIndex(i => 
        i.item_name.toLowerCase() === itemName.toLowerCase()
      );

      if (itemIndex === -1) {
        logger.warn({ item_name: itemName }, 'Inventory item not found');
        return;
      }

      const newQuantity = inventory[itemIndex].quantity + quantityChange;
      const rowNumber = itemIndex + 2; // +2 because 1-indexed and header row

      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `Inventory!B${rowNumber}`,
        valueInputOption: 'RAW',
        resource: { values: [[newQuantity]] },
      });

      // Update last_updated timestamp
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `Inventory!F${rowNumber}`,
        valueInputOption: 'RAW',
        resource: { values: [[new Date().toISOString()]] },
      });

      logger.info({ 
        item_name: itemName, 
        quantity_change: quantityChange, 
        new_quantity: newQuantity 
      }, 'Inventory updated');
    } catch (error) {
      logger.error({ error, itemName }, 'Failed to update inventory');
      throw error;
    }
  }

  // Orders Operations
  async addOrder(order: Order): Promise<void> {
    try {
      const values = [[
        order.order_id,
        order.customer_name,
        order.customer_phone,
        order.items,
        order.quantity,
        order.amount,
        order.payment_status || 'PENDING',
        order.payment_id || '',
        order.order_date || new Date().toISOString(),
        order.date,
        order.delivery_boy || '',
        order.status || 'PENDING',
        order.notes || '',
        order.language || 'en'
      ]];

      await this.sheets.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: 'Orders!A:N',
        valueInputOption: 'RAW',
        resource: { values },
      });

      logger.info({ order_id: order.order_id }, 'Order appended to Google Sheets');
    } catch (error) {
      logger.error({ error, order }, 'Failed to append order');
      throw error;
    }
  }

  async getAllOrders(): Promise<Order[]> {
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'Orders!A2:N',
      });

      const rows = response.data.values || [];
      return rows.map((row: any[]): Order => ({
        order_id: row[0],
        customer_name: row[1],
        customer_phone: row[2],
        items: row[3],
        quantity: parseInt(row[4]) || 0,
        amount: parseFloat(row[5]) || 0,
        payment_status: row[6] || 'PENDING',
        payment_id: row[7] || '',
        order_date: row[8],
        date: row[9] || '',
        delivery_boy: row[10] || '',
        status: (row[11] || 'PENDING') as OrderStatus,
        notes: row[12] || '',
        language: row[13] || 'en'
      }));
    } catch (error) {
      logger.error({ error }, 'Failed to get orders');
      return [];
    }
  }

  async getUpcomingOrderByCustomerPhone(phone: string): Promise<Order | null> {
    const orders = await this.getAllOrders();
    const today = new Date().toISOString().split('T')[0];
    const upcoming = orders
      .filter(o =>
        o.customer_phone === phone &&
        o.date >= today &&
        ACTIVE_ORDER_STATUSES.includes(o.status)
      )
      .sort((a, b) => a.date.localeCompare(b.date));
    return upcoming[0] || null;
  }

  async updateOrderStatus(orderId: string, status: OrderStatus, notes?: string): Promise<void> {
    try {
      const orders = await this.getAllOrders();
      const orderIndex = orders.findIndex(o => o.order_id === orderId);

      if (orderIndex === -1) {
        logger.warn({ order_id: orderId }, 'Order not found');
        return;
      }

      const rowNumber = orderIndex + 2;
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `Orders!L${rowNumber}`,
        valueInputOption: 'RAW',
        resource: { values: [[status]] },
      });

      if (notes) {
        await this.sheets.spreadsheets.values.update({
          spreadsheetId: this.spreadsheetId,
          range: `Orders!M${rowNumber}`,
          valueInputOption: 'RAW',
          resource: { values: [[notes]] },
        });
      }

      logger.info({ order_id: orderId, status }, 'Order status updated');
    } catch (error) {
      logger.error({ error, orderId }, 'Failed to update order status');
      throw error;
    }
  }

  async updateOrderDate(orderId: string, newDate: string): Promise<void> {
    try {
      const orders = await this.getAllOrders();
      const orderIndex = orders.findIndex(o => o.order_id === orderId);

      if (orderIndex === -1) {
        logger.warn({ order_id: orderId }, 'Order not found');
        return;
      }

      const rowNumber = orderIndex + 2;
      await this.sheets.spreadsheets.values.update({
        spreadsheetId: this.spreadsheetId,
        range: `Orders!J${rowNumber}`,
        valueInputOption: 'RAW',
        resource: { values: [[newDate]] },
      });

      logger.info({ order_id: orderId, new_date: newDate }, 'Order date updated');
    } catch (error) {
      logger.error({ error, orderId }, 'Failed to update order date');
      throw error;
    }
  }

  // The Sheets store has no Deliveries sheet yet; delivery-boy assignment is
  // an Excel-mode feature. These satisfy DataStore without pretending to work.
  async getDeliveryByOrderId(orderId: string): Promise<Delivery | null> {
    logger.debug({ order_id: orderId }, 'Deliveries not tracked in Google Sheets store');
    return null;
  }

  async updateDeliveryStatus(deliveryId: string, _status: Delivery['status']): Promise<void> {
    logger.debug({ delivery_id: deliveryId }, 'Deliveries not tracked in Google Sheets store');
  }

  async addDailyLog(log: DailyLog): Promise<void> {
    try {
      const values = [[
        log.date,
        log.total_orders,
        log.delivered_orders,
        log.canceled_orders,
        log.total_sales,
        log.total_costs,
        log.profit,
        log.notes
      ]];

      await this.sheets.spreadsheets.values.append({
        spreadsheetId: this.spreadsheetId,
        range: 'Daily_Logs!A:H',
        valueInputOption: 'RAW',
        resource: { values },
      });

      logger.info({ date: log.date }, 'Daily log appended to Google Sheets');
    } catch (error) {
      logger.error({ error }, 'Failed to append daily log');
      throw error;
    }
  }

  async updateOrderPayment(orderId: string, paymentId: string): Promise<void> {
    try {
      const orders = await this.getAllOrders();
      const orderIndex = orders.findIndex(o => o.order_id === orderId);

      if (orderIndex === -1) return;

      const rowNumber = orderIndex + 2;
      
      // Update payment status and payment ID
      await this.sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: this.spreadsheetId,
        resource: {
          data: [
            {
              range: `Orders!G${rowNumber}`,
              values: [['PAID']]
            },
            {
              range: `Orders!H${rowNumber}`,
              values: [[paymentId]]
            }
          ],
          valueInputOption: 'RAW',
        },
      });

      logger.info({ order_id: orderId, payment_id: paymentId }, 'Payment updated');
    } catch (error) {
      logger.error({ error }, 'Failed to update payment');
      throw error;
    }
  }

  // FAQ Operations
  async searchFAQ(question: string, language: string = 'en'): Promise<string | null> {
    try {
      const response = await this.sheets.spreadsheets.values.get({
        spreadsheetId: this.spreadsheetId,
        range: 'FAQ!A2:K',
      });

      const rows = response.data.values || [];
      const questionCol = language === 'ar' ? 2 : language === 'hi' ? 4 : language === 'ur' ? 6 : 0;
      const answerCol = questionCol + 1;

      // Simple keyword matching
      for (const row of rows) {
        const keywords = (row[8] || '').toLowerCase().split(',');
        const questionLower = question.toLowerCase();
        
        if (keywords.some((kw: string) => questionLower.includes(kw.trim()))) {
          return row[answerCol] || row[1]; // Return in requested language or English fallback
        }
      }

      return null;
    } catch (error) {
      logger.error({ error }, 'Failed to search FAQ');
      return null;
    }
  }

  // Initialize sheets if they don't exist
  async initializeSheets(): Promise<void> {
    try {
      // Check if sheets exist, if not create them
      const spreadsheet = await this.sheets.spreadsheets.get({
        spreadsheetId: this.spreadsheetId,
      });

      const sheetNames = spreadsheet.data.sheets.map((s: any) => s.properties.title);

      if (!sheetNames.includes('Inventory')) {
        await this.createInventorySheet();
      }
      if (!sheetNames.includes('Orders')) {
        await this.createOrdersSheet();
      }
      if (!sheetNames.includes('FAQ')) {
        await this.createFAQSheet();
      }
      if (!sheetNames.includes('Daily_Logs')) {
        await this.createDailyLogsSheet();
      }

      logger.info('Google Sheets initialized');
    } catch (error) {
      logger.error({ error }, 'Failed to initialize sheets');
    }
  }

  private async createInventorySheet() {
    const headers = [['flower_name', 'quantity', 'unit_price', 'cost_price', 'max_stock', 'last_updated', 'language_names']];
    const sampleData = [
      ['Roses', 100, 50, 30, 200, new Date().toISOString(), 'Roses|ورد|गुलाब|گلاب'],
      ['Lilies', 60, 60, 35, 150, new Date().toISOString(), 'Lilies|زنبق|कुमुदिनी|للی'],
      ['Tulips', 40, 45, 25, 100, new Date().toISOString(), 'Tulips|توليب|ट्यूलिप|ٹیولپ']
    ];

    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: 'Inventory!A1:G4',
      valueInputOption: 'RAW',
      resource: { values: [...headers, ...sampleData] },
    });
  }

  private async createOrdersSheet() {
    const headers = [['order_id', 'customer_name', 'customer_phone', 'items', 'quantity', 'total_amount', 'payment_status', 'payment_id', 'order_date', 'delivery_date', 'delivery_boy', 'status', 'notes', 'language']];

    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: 'Orders!A1:N1',
      valueInputOption: 'RAW',
      resource: { values: headers },
    });
  }

  private async createDailyLogsSheet() {
    const headers = [['date', 'total_orders', 'delivered_orders', 'canceled_orders', 'total_sales', 'total_costs', 'profit', 'notes']];

    // values.update can't create a missing tab, so add the sheet first
    await this.sheets.spreadsheets.batchUpdate({
      spreadsheetId: this.spreadsheetId,
      resource: {
        requests: [{ addSheet: { properties: { title: 'Daily_Logs' } } }],
      },
    });

    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: 'Daily_Logs!A1:H1',
      valueInputOption: 'RAW',
      resource: { values: headers },
    });
  }

  private async createFAQSheet() {
    const headers = [['question_en', 'answer_en', 'question_ar', 'answer_ar', 'question_hi', 'answer_hi', 'question_ur', 'answer_ur', 'category', 'keywords']];
    const sampleData = [
      [
        'What flowers do you have?',
        'We have roses, lilies, tulips and more. Check our inventory!',
        'ما هي الزهور المتوفرة؟',
        'لدينا الورد والزنبق والتوليب والمزيد',
        'आपके पास कौन से फूल हैं?',
        'हमारे पास गुलाब, कुमुदिनी, ट्यूलिप और बहुत कुछ है',
        'آپ کے پاس کون سے پھول ہیں؟',
        'ہمارے پاس گلاب، للی، ٹیولپ اور بہت کچھ ہے',
        'inventory',
        'flowers,available,have,stock'
      ]
    ];

    await this.sheets.spreadsheets.values.update({
      spreadsheetId: this.spreadsheetId,
      range: 'FAQ!A1:J2',
      valueInputOption: 'RAW',
      resource: { values: [...headers, ...sampleData] },
    });
  }
}
