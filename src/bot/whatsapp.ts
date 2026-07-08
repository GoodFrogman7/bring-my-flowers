import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  WASocket,
  proto,
  Browsers,
  makeCacheableSignalKeyStore
} from '@whiskeysockets/baileys';
import * as QRCode from 'qrcode-terminal';
import logger from '../utils/logger';
import { Boom } from '@hapi/boom';
import { MessageSender } from './messageSender';

export class WhatsAppBot implements MessageSender {
  private sock: WASocket | null = null;
  private sessionPath: string;
  private reconnectDelay: number;
  private maxReconnectAttempts: number;
  private reconnectAttempts: number = 0;
  private messageHandler: ((from: string, message: string) => Promise<void>) | null = null;
  private connected: boolean = false;

  constructor(
    sessionPath: string,
    reconnectDelay: number = 5000,
    maxReconnectAttempts: number = 10
  ) {
    this.sessionPath = sessionPath;
    this.reconnectDelay = reconnectDelay;
    this.maxReconnectAttempts = maxReconnectAttempts;
  }

  async start(): Promise<void> {
    try {
      const { state, saveCreds } = await useMultiFileAuthState(this.sessionPath);

      this.sock = makeWASocket({
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, logger)
        },
        printQRInTerminal: false,
        browser: Browsers.ubuntu('Chrome'),
        logger: logger as any,
        getMessage: async (key) => {
          return { conversation: '' };
        }
      });

      // QR Code handler
      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          logger.info('QR Code received. Scan with WhatsApp:');
          QRCode.generate(qr, { small: true });
        }

        if (connection === 'close') {
          this.connected = false;
          const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
          
          logger.warn({
            shouldReconnect,
            statusCode: (lastDisconnect?.error as Boom)?.output?.statusCode,
            error: lastDisconnect?.error
          }, 'Connection closed');

          if (shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            logger.info({
              attempt: this.reconnectAttempts,
              maxAttempts: this.maxReconnectAttempts,
              delay: this.reconnectDelay
            }, 'Attempting to reconnect');
            
            setTimeout(() => this.start(), this.reconnectDelay);
          } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            logger.error('Max reconnect attempts reached. Please restart the bot.');
          } else {
            logger.error('Logged out from WhatsApp. Please delete sessions folder and restart.');
          }
        }

        if (connection === 'open') {
          this.connected = true;
          this.reconnectAttempts = 0;
          logger.info('WhatsApp connection established successfully! 🎉');
        }
      });

      // Save credentials on update
      this.sock.ev.on('creds.update', saveCreds);

      // Message handler
      this.sock.ev.on('messages.upsert', async ({ messages }) => {
        for (const msg of messages) {
          await this.handleIncomingMessage(msg);
        }
      });

    } catch (error) {
      logger.error({ error }, 'Failed to start WhatsApp bot');
      throw error;
    }
  }

  private async handleIncomingMessage(msg: proto.IWebMessageInfo): Promise<void> {
    try {
      // Ignore if message is from self or status broadcast
      if (msg.key.fromMe || msg.key.remoteJid === 'status@broadcast') return;

      // Ignore group chats: the handlers model 1:1 conversations, and a group
      // jid would be mistaken for a customer phone (the bot would greet the
      // whole ops group). Group integration is a deliberate future feature.
      if (msg.key.remoteJid?.endsWith('@g.us')) return;

      // Extract message text
      const messageText = msg.message?.conversation ||
                         msg.message?.extendedTextMessage?.text ||
                         '';

      if (!messageText) return;

      // Get sender's phone number
      const from = msg.key.remoteJid || '';
      const phoneNumber = from.split('@')[0];

      logger.info({
        from: phoneNumber,
        message: messageText
      }, 'Message received');

      // Call the registered message handler
      if (this.messageHandler) {
        await this.messageHandler(phoneNumber, messageText);
      }
    } catch (error) {
      logger.error({ error, msg }, 'Error handling incoming message');
    }
  }

  onMessage(handler: (from: string, message: string) => Promise<void>): void {
    this.messageHandler = handler;
  }

  async sendMessage(to: string, message: string): Promise<boolean> {
    if (!this.sock || !this.connected) {
      logger.error({ to }, 'Cannot send message: Not connected');
      return false;
    }

    try {
      // Ensure phone number format
      const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;
      
      await this.sock.sendMessage(jid, { text: message });
      
      logger.info({ to, message }, 'Message sent');
      return true;
    } catch (error) {
      logger.error({ error, to, message }, 'Failed to send message');
      return false;
    }
  }

  async sendMessageToMultiple(recipients: string[], message: string): Promise<void> {
    for (const recipient of recipients) {
      await this.sendMessage(recipient, message);
      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  async disconnect(): Promise<void> {
    if (this.sock) {
      await this.sock.logout();
      this.sock = null;
      this.connected = false;
      logger.info('WhatsApp bot disconnected');
    }
  }
}

