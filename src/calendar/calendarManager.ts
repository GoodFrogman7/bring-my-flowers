import { google } from 'googleapis';
import logger from '../utils/logger';

export class CalendarManager {
  private calendar: any;
  private calendarId: string;

  constructor(auth: any, calendarId: string = 'primary') {
    this.calendar = google.calendar({ version: 'v3', auth });
    this.calendarId = calendarId;
    logger.info('Calendar manager initialized');
  }

  async createDeliveryEvent(order: any, delivery: any): Promise<string> {
    try {
      const startTime = new Date(delivery.scheduled_date);
      const endTime = new Date(startTime);
      endTime.setHours(endTime.getHours() + 1);

      const event = {
        summary: `🌸 Delivery: ${order.customer_name}`,
        description: `Order ID: ${order.order_id}\n\nItems: ${order.items}\nQuantity: ${order.quantity}\nAmount: ₹${order.total_amount}\n\nCustomer Phone: ${order.customer_phone}\nDelivery Boy: ${delivery.delivery_boy || 'TBD'}\n\nNotes: ${order.notes || 'None'}`,
        start: {
          dateTime: startTime.toISOString(),
          timeZone: 'Asia/Kolkata',
        },
        end: {
          dateTime: endTime.toISOString(),
          timeZone: 'Asia/Kolkata',
        },
        colorId: '10', // Green for deliveries
        reminders: {
          useDefault: false,
          overrides: [
            { method: 'popup', minutes: 60 },
            { method: 'popup', minutes: 30 },
          ],
        },
      };

      const response = await this.calendar.events.insert({
        calendarId: this.calendarId,
        resource: event,
      });

      logger.info({
        order_id: order.order_id,
        event_id: response.data.id
      }, 'Calendar event created');

      return response.data.id;
    } catch (error) {
      logger.error({ error, order }, 'Failed to create calendar event');
      throw error;
    }
  }

  async updateDeliveryEvent(eventId: string, newDate: Date): Promise<void> {
    try {
      const endTime = new Date(newDate);
      endTime.setHours(endTime.getHours() + 1);

      await this.calendar.events.patch({
        calendarId: this.calendarId,
        eventId: eventId,
        resource: {
          start: {
            dateTime: newDate.toISOString(),
            timeZone: 'Asia/Kolkata',
          },
          end: {
            dateTime: endTime.toISOString(),
            timeZone: 'Asia/Kolkata',
          },
        },
      });

      logger.info({ event_id: eventId, new_date: newDate }, 'Calendar event updated');
    } catch (error) {
      logger.error({ error, eventId }, 'Failed to update calendar event');
    }
  }

  async deleteDeliveryEvent(eventId: string): Promise<void> {
    try {
      await this.calendar.events.delete({
        calendarId: this.calendarId,
        eventId: eventId,
      });

      logger.info({ event_id: eventId }, 'Calendar event deleted');
    } catch (error) {
      logger.error({ error, eventId }, 'Failed to delete calendar event');
    }
  }

  async createLowStockAlert(flower: string, quantity: number, threshold: number): Promise<void> {
    try {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9, 0, 0, 0);

      const event = {
        summary: `⚠️ LOW STOCK: ${flower}`,
        description: `Current stock: ${quantity} units\nThreshold: ${threshold} units\n\nPlease restock ${flower} as soon as possible.`,
        start: {
          dateTime: tomorrow.toISOString(),
          timeZone: 'Asia/Kolkata',
        },
        end: {
          dateTime: new Date(tomorrow.getTime() + 30 * 60000).toISOString(),
          timeZone: 'Asia/Kolkata',
        },
        colorId: '11', // Red for alerts
      };

      await this.calendar.events.insert({
        calendarId: this.calendarId,
        resource: event,
      });

      logger.info({ flower, quantity }, 'Low stock alert added to calendar');
    } catch (error) {
      logger.error({ error }, 'Failed to create low stock alert');
    }
  }
}
