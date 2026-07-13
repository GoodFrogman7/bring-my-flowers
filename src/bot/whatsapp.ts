import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  WASocket,
  proto,
  Browsers,
  makeCacheableSignalKeyStore
} from '@whiskeysockets/baileys';
import * as QRCode from 'qrcode-terminal';
import * as fs from 'fs';
import * as path from 'path';
import logger from '../utils/logger';
import { Boom } from '@hapi/boom';
import { MessageSender } from './messageSender';

/**
 * How long a disconnect may last before the process gives up and exits.
 * Generous: a full reconnect cycle (10 attempts × 5s) fits several times over.
 */
const RECONNECT_WATCHDOG_MS = 3 * 60 * 1000;

export class WhatsAppBot implements MessageSender {
  private sock: WASocket | null = null;
  private sessionPath: string;
  private reconnectDelay: number;
  private maxReconnectAttempts: number;
  private reconnectAttempts: number = 0;
  private messageHandler: ((from: string, message: string) => Promise<void>) | null = null;
  private groupMessageHandler: ((participant: string, message: string) => Promise<void>) | null = null;
  private connected: boolean = false;
  private updatesGroupJid?: string;
  private pairingRequested: boolean = false;
  private reconnectWatchdog: NodeJS.Timeout | null = null;

  constructor(
    sessionPath: string,
    reconnectDelay: number = 5000,
    maxReconnectAttempts: number = 10,
    updatesGroupJid?: string
  ) {
    this.sessionPath = sessionPath;
    this.reconnectDelay = reconnectDelay;
    this.maxReconnectAttempts = maxReconnectAttempts;
    this.updatesGroupJid = updatesGroupJid;
  }

  async start(): Promise<void> {
    try {
      this.pairingRequested = false;
      const { state, saveCreds } = await useMultiFileAuthState(this.sessionPath);

      // WhatsApp rejects registration (405) when the advertised WA Web
      // version is stale — always fetch the current one at startup.
      const { version } = await fetchLatestBaileysVersion();
      logger.info({ version }, 'Using WhatsApp Web version');

      this.sock = makeWASocket({
        version,
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
          await this.maybeRequestPairingCode();
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

            this.armReconnectWatchdog();
            setTimeout(() => {
              this.start().catch(error => {
                logger.error({ error }, 'Reconnect attempt threw — exiting so the launcher restarts a fresh process');
                process.exit(1);
              });
            }, this.reconnectDelay);
          } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            logger.error('Max reconnect attempts reached — exiting so the launcher restarts a fresh process.');
            process.exit(1);
          } else {
            logger.error('Logged out from WhatsApp. Please delete sessions folder and restart.');
          }
        }

        if (connection === 'open') {
          this.connected = true;
          this.reconnectAttempts = 0;
          this.clearReconnectWatchdog();
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

  /**
   * A reconnect can hang without ever emitting another connection.update
   * (seen 2026-07-12: stream error 515 → "attempt 1" logged → silence for
   * 25 hours). The launcher only restarts us when the process exits, so if
   * we aren't back online within the window, exit and let it.
   */
  private armReconnectWatchdog(): void {
    if (this.reconnectWatchdog) return;
    this.reconnectWatchdog = setTimeout(() => {
      this.reconnectWatchdog = null;
      if (!this.connected) {
        logger.error({ windowMs: RECONNECT_WATCHDOG_MS }, 'Still disconnected after the reconnect window — exiting so the launcher restarts a fresh process');
        process.exit(1);
      }
    }, RECONNECT_WATCHDOG_MS);
  }

  private clearReconnectWatchdog(): void {
    if (this.reconnectWatchdog) {
      clearTimeout(this.reconnectWatchdog);
      this.reconnectWatchdog = null;
    }
  }

  /**
   * Alternative to QR scanning: when PAIRING_NUMBER is set, ask WhatsApp for
   * an 8-character code the owner types in via Linked Devices → "Link with
   * phone number instead". Requested once per connection attempt.
   */
  private async maybeRequestPairingCode(): Promise<void> {
    const raw = process.env.PAIRING_NUMBER;
    if (!raw || this.pairingRequested || !this.sock || this.sock.authState.creds.registered) return;
    this.pairingRequested = true;
    const phone = raw.replace(/[^0-9]/g, '');
    try {
      const code = await this.sock.requestPairingCode(phone);
      const pretty = code.match(/.{1,4}/g)?.join('-') ?? code;
      logger.info({ pairingCode: pretty }, 'Pairing code issued — enter it on the phone');
      console.log(`\n🔗 PAIRING CODE for +${phone}: ${pretty}`);
      console.log('   WhatsApp → Settings → Linked Devices → Link a Device → "Link with phone number instead"\n');
    } catch (error) {
      logger.error({ error }, 'Failed to request pairing code — fall back to scanning the QR above');
      this.pairingRequested = false;
    }
  }

  private async handleIncomingMessage(msg: proto.IWebMessageInfo): Promise<void> {
    try {
      // Log group JIDs even for own-account messages, so UPDATES_GROUP_JID can
      // be discovered by the owner texting the group from the linked number.
      if (msg.key.fromMe && msg.key.remoteJid?.endsWith('@g.us') && msg.key.remoteJid !== this.updatesGroupJid) {
        logger.info({ groupJid: msg.key.remoteJid }, 'Ignored message from non-whitelisted group');
      }

      // Ignore if message is from self or status broadcast
      if (msg.key.fromMe || msg.key.remoteJid === 'status@broadcast') return;

      // Whitelisted exception: the one "Updates" ops group, if configured.
      // Every other group stays ignored below exactly as before.
      if (this.updatesGroupJid && msg.key.remoteJid === this.updatesGroupJid) {
        const participant = msg.key.participant;
        if (!participant) return; // system/announce messages can lack a participant
        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
        if (!text || !this.groupMessageHandler) return;
        await this.groupMessageHandler(participant.split('@')[0], text);
        return;
      }

      // Ignore group chats: the handlers model 1:1 conversations, and a group
      // jid would be mistaken for a customer phone (the bot would greet the
      // whole ops group). Logged so a group's JID can be found and whitelisted
      // via UPDATES_GROUP_JID (see .env.example) without any special tooling.
      if (msg.key.remoteJid?.endsWith('@g.us')) {
        logger.info({ groupJid: msg.key.remoteJid }, 'Ignored message from non-whitelisted group');
        return;
      }

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

  /** Registers the handler for the whitelisted "Updates" group only (see updatesGroupJid). */
  onGroupMessage(handler: (participant: string, message: string) => Promise<void>): void {
    this.groupMessageHandler = handler;
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

  async sendDocument(to: string, filePath: string, caption?: string): Promise<boolean> {
    if (!this.sock || !this.connected) {
      logger.error({ to, filePath }, 'Cannot send document: Not connected');
      return false;
    }

    const MIMETYPES: Record<string, string> = {
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.pdf': 'application/pdf'
    };

    try {
      const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;
      const fileName = path.basename(filePath);
      await this.sock.sendMessage(jid, {
        document: fs.readFileSync(filePath),
        fileName,
        mimetype: MIMETYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
        caption
      });
      logger.info({ to, filePath }, 'Document sent');
      return true;
    } catch (error) {
      logger.error({ error, to, filePath }, 'Failed to send document');
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

