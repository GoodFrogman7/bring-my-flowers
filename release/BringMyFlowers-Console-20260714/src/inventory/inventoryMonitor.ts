import * as cron from 'node-cron';
import { DataStore } from '../data/dataStore';
import { CalendarManager } from '../calendar/calendarManager';
import { MessageSender } from '../bot/messageSender';
import { responses, formatResponse } from '../i18n/languageDetector';
import logger from '../utils/logger';

export class InventoryMonitor {
  private sheetsManager: DataStore;
  private calendarManager: CalendarManager | null;
  private whatsappBot: MessageSender;
  private ownerNumbers: string[];
  private alertedItems: Set<string> = new Set();
  private cronJob: cron.ScheduledTask | null = null;

  constructor(
    sheetsManager: DataStore,
    whatsappBot: MessageSender,
    ownerNumbers: string[],
    calendarManager?: CalendarManager
  ) {
    this.sheetsManager = sheetsManager;
    this.whatsappBot = whatsappBot;
    this.ownerNumbers = ownerNumbers;
    this.calendarManager = calendarManager || null;
  }

  start(): void {
    // Run every hour
    this.cronJob = cron.schedule('0 * * * *', async () => {
      logger.info('Running inventory check');
      await this.checkInventoryLevels();
    });

    logger.info('Inventory monitor started (runs hourly)');
    
    // Run immediately on start
    this.checkInventoryLevels();
  }

  stop(): void {
    if (this.cronJob) {
      this.cronJob.stop();
      logger.info('Inventory monitor stopped');
    }
  }

  async checkInventoryLevels(): Promise<void> {
    try {
      const inventory = await this.sheetsManager.getAllInventory();
      const lowStockItems: any[] = [];

      for (const item of inventory) {
        const maxStock = item.max_stock || 100; // Default to 100 if not set
        const threshold = maxStock * 0.2; // 20% threshold
        
        if (item.quantity < threshold) {
          // Check if we've already alerted for this item in the last 24 hours
          const alertKey = `${item.item_name}_${new Date().toDateString()}`;
          
          if (!this.alertedItems.has(alertKey)) {
            lowStockItems.push({
              flower: item.item_name,
              quantity: item.quantity,
              max: maxStock,
              threshold: Math.round(threshold),
              percent: Math.round((item.quantity / maxStock) * 100)
            });

            this.alertedItems.add(alertKey);
          }
        }
      }

      if (lowStockItems.length > 0) {
        await this.sendLowStockAlerts(lowStockItems);
      }

      // Clean up old alert keys (older than 24 hours)
      const today = new Date().toDateString();
      this.alertedItems.forEach(key => {
        if (!key.endsWith(today)) {
          this.alertedItems.delete(key);
        }
      });

    } catch (error) {
      logger.error({ error }, 'Failed to check inventory levels');
    }
  }

  private async sendLowStockAlerts(items: any[]): Promise<void> {
    try {
      // Group alerts into one message
      const alertLines = items.map(item => 
        formatResponse(responses.low_stock_alert['en'], item)
      );

      const message = `🚨 LOW STOCK ALERTS\n\n${alertLines.join('\n\n')}\n\nPlease restock these items soon!`;

      // Send to all owners
      for (const ownerNumber of this.ownerNumbers) {
        await this.whatsappBot.sendMessage(ownerNumber, message);
        logger.info({ owner: ownerNumber, items_count: items.length }, 'Low stock alert sent');
      }

      // Create calendar events if calendar manager is available
      if (this.calendarManager) {
        for (const item of items) {
          await this.calendarManager.createLowStockAlert(
            item.flower,
            item.quantity,
            item.threshold
          );
        }
      }

    } catch (error) {
      logger.error({ error }, 'Failed to send low stock alerts');
    }
  }

  async forceCheck(): Promise<void> {
    logger.info('Manual inventory check triggered');
    await this.checkInventoryLevels();
  }
}
