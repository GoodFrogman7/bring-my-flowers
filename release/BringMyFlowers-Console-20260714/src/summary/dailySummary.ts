import * as cron from 'node-cron';
import { OllamaClient } from '../llm/ollama';
import { DataStore } from '../data/dataStore';
import { MessageSender } from '../bot/messageSender';
import { parseItems } from '../utils/orderItems';
import logger from '../utils/logger';
import { DailySummary } from '../types';

export class DailySummaryGenerator {
  private ollamaClient: OllamaClient;
  private excelManager: DataStore;
  private bot: MessageSender;
  private ownerNumbers: string[];
  private summaryTime: string;
  private cronJob: cron.ScheduledTask | null = null;

  constructor(
    ollamaClient: OllamaClient,
    excelManager: DataStore,
    bot: MessageSender,
    ownerNumbers: string[],
    summaryTime: string = '22:00'
  ) {
    this.ollamaClient = ollamaClient;
    this.excelManager = excelManager;
    this.bot = bot;
    this.ownerNumbers = ownerNumbers;
    this.summaryTime = summaryTime;
  }

  start(): void {
    // Parse time (HH:mm format)
    const [hour, minute] = this.summaryTime.split(':').map(Number);
    
    // Schedule cron job: minute hour * * *
    const cronExpression = `${minute} ${hour} * * *`;
    
    // The business runs on IST regardless of the host machine's clock.
    this.cronJob = cron.schedule(cronExpression, async () => {
      logger.info('Daily summary cron job triggered');
      await this.generateAndSendSummary();
    }, { timezone: 'Asia/Kolkata' });

    logger.info({ schedule: cronExpression, time: this.summaryTime, timezone: 'Asia/Kolkata' }, 'Daily summary scheduler started');
  }

  stop(): void {
    if (this.cronJob) {
      this.cronJob.stop();
      logger.info('Daily summary scheduler stopped');
    }
  }

  async generateAndSendSummary(date?: string): Promise<DailySummary | null> {
    try {
      const targetDate = date || new Date().toISOString().split('T')[0];
      logger.info({ date: targetDate }, 'Generating daily summary');

      // Get all orders for the date
      const allOrders = await this.excelManager.getAllOrders();
      const dayOrders = allOrders.filter(order => order.date === targetDate);

      if (dayOrders.length === 0) {
        logger.info({ date: targetDate }, 'No orders for this date');
        await this.sendNoOrdersMessage(targetDate);
        return null;
      }

      // Calculate metrics
      const totalOrders = dayOrders.length;
      const deliveredOrders = dayOrders.filter(o => o.status === 'DELIVERED').length;
      const canceledOrders = dayOrders.filter(o => o.status === 'CANCELED').length;
      
      const totalRevenue = dayOrders
        .filter(o => o.status === 'DELIVERED')
        .reduce((sum, order) => sum + order.amount, 0);

      // Calculate costs based on inventory used
      const inventory = await this.excelManager.getAllInventory();
      const inventoryMap = new Map(inventory.map(item => [item.item_name.toLowerCase(), item]));

      let totalCosts = 0;
      const inventoryUsed: Array<{ item: string; quantity: number }> = [];
      const inventoryUsageMap = new Map<string, number>();

      // Track inventory usage per line item
      for (const order of dayOrders.filter(o => o.status === 'DELIVERED')) {
        for (const item of parseItems(order.items, order.quantity)) {
          const key = item.name.toLowerCase();
          inventoryUsageMap.set(key, (inventoryUsageMap.get(key) || 0) + item.quantity);

          const inventoryItem = inventoryMap.get(key);
          if (inventoryItem) {
            totalCosts += inventoryItem.cost_price * item.quantity;
          }
        }
      }

      // Build inventory used array
      for (const [itemName, quantity] of inventoryUsageMap) {
        inventoryUsed.push({ item: itemName, quantity });
      }

      // Get remaining inventory
      const inventoryRemaining = inventory.map(item => ({
        item: item.item_name,
        quantity: item.quantity
      }));

      const profit = totalRevenue - totalCosts;

      // Generate summary using Ollama
      const summaryData = {
        date: targetDate,
        totalOrders,
        deliveredOrders,
        canceledOrders,
        totalRevenue,
        totalCosts,
        profit,
        inventoryUsed,
        inventoryRemaining
      };

      const report = await this.ollamaClient.generateDailySummary(summaryData);

      // Save to daily logs
      await this.excelManager.addDailyLog({
        date: targetDate,
        total_orders: totalOrders,
        delivered_orders: deliveredOrders,
        canceled_orders: canceledOrders,
        total_sales: totalRevenue,
        total_costs: totalCosts,
        profit: profit,
        notes: report
      });

      // Send to owners
      await this.sendSummaryToOwners(report);

      logger.info({ date: targetDate, profit }, 'Daily summary generated and sent');

      return {
        ...summaryData,
        report
      };
    } catch (error) {
      logger.error({ error }, 'Failed to generate daily summary');
      
      // Notify owners of the error
      const errorMessage = "⚠️ Daily Summary Error\n\nThere was an error generating today's business summary. Please check the logs or Excel file manually.";
      await this.sendSummaryToOwners(errorMessage);
      
      return null;
    }
  }

  private async sendSummaryToOwners(message: string): Promise<void> {
    if (this.ownerNumbers.length === 0) {
      logger.warn('No owner numbers configured for daily summary');
      return;
    }

    for (const ownerNumber of this.ownerNumbers) {
      try {
        await this.bot.sendMessage(ownerNumber, message);
        logger.info({ owner: ownerNumber }, 'Daily summary sent to owner');
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        logger.error({ error, owner: ownerNumber }, 'Failed to send summary to owner');
      }
    }
  }

  private async sendNoOrdersMessage(date: string): Promise<void> {
    const message = `📊 Daily Business Summary - ${date}

No orders were placed or processed today.

This might be a holiday, weekend, or a slow business day. Check the calendar for any scheduled orders.`;

    await this.sendSummaryToOwners(message);
  }

  // Manual trigger for testing
  async generateNow(): Promise<DailySummary | null> {
    logger.info('Manual daily summary generation triggered');
    return await this.generateAndSendSummary();
  }

  // Generate for specific past date
  async generateForDate(date: string): Promise<DailySummary | null> {
    logger.info({ date }, 'Generating summary for specific date');
    return await this.generateAndSendSummary(date);
  }
}

