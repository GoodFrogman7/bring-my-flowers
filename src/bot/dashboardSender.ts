import logger from '../utils/logger';
import { MessageSender } from './messageSender';

/**
 * Message sender used by dashboard-first business mode.
 *
 * The business engine still expects a sender because the same Q&A and
 * scheduler code can run with WhatsApp attached. In dashboard mode there is
 * deliberately nowhere to send a message: updates enter through the local
 * console and sheets are downloaded from it. Keeping this explicit adapter
 * prevents accidental WhatsApp initialization or outbound traffic.
 */
export class DashboardMessageSender implements MessageSender {
  private connected = true;

  async sendMessage(to: string, _message: string): Promise<boolean> {
    logger.warn({ to }, 'Dashboard mode has no outbound messaging transport');
    return false;
  }

  async sendMessageToMultiple(recipients: string[], _message: string): Promise<void> {
    if (recipients.length > 0) {
      logger.warn({ recipients: recipients.length }, 'Dashboard mode skipped outbound messages');
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
  }
}
