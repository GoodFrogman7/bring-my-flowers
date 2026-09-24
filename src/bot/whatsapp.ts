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
import { groupSendBlocked } from './groupSilence';

export interface IncomingGroupMessageMetadata {
  externalMessageId?: string;
  replyToExternalId?: string;
  receivedAt: string;
}

export interface WhatsAppHealth {
  connected: boolean;
  linked: boolean;
  /** E.164-ish display number for the linked business phone, if known. */
  phoneNumber: string | null;
  lastError: string | null;
  lastDisconnectStatus: number | null;
  reconnectAttempts: number;
  latestQr: string | null;
  updatesGroupJid: string | null;
}

/** Baileys JID / id → display phone (e.g. 9197…:12@s.whatsapp.net → +9197…). */
export function formatLinkedPhone(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const digits = raw.split('@')[0]?.split(':')[0]?.replace(/\D/g, '') ?? '';
  if (digits.length < 8) return null;
  return `+${digits}`;
}

/**
 * How long a disconnect may last before the process gives up and exits.
 * Generous: a full reconnect cycle (10 attempts × 5s) fits several times over.
 */
const RECONNECT_WATCHDOG_MS = 3 * 60 * 1000;
/** If we never come online for this long after a drop, exit for launcher restart. */
const DISCONNECT_EXIT_MS = 5 * 60 * 1000;

export class WhatsAppBot implements MessageSender {
  private sock: WASocket | null = null;
  private sessionPath: string;
  private reconnectDelay: number;
  private maxReconnectAttempts: number;
  private reconnectAttempts: number = 0;
  private messageHandler: ((from: string, message: string) => Promise<void>) | null = null;
  private groupMessageHandler: ((
    participant: string,
    message: string,
    metadata: IncomingGroupMessageMetadata
  ) => Promise<void>) | null = null;
  private connected: boolean = false;
  private updatesGroupJid?: string;
  private pairingRequested: boolean = false;
  private reconnectWatchdog: NodeJS.Timeout | null = null;
  private disconnectExitTimer: NodeJS.Timeout | null = null;
  private lastError: string | null = null;
  private lastDisconnectStatus: number | null = null;
  private latestQr: string | null = null;
  private starting: boolean = false;

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

  getHealth(): WhatsAppHealth {
    return {
      connected: this.connected,
      linked: fs.existsSync(path.join(this.sessionPath, 'creds.json')),
      phoneNumber: this.resolveLinkedPhone(),
      lastError: this.lastError,
      lastDisconnectStatus: this.lastDisconnectStatus,
      reconnectAttempts: this.reconnectAttempts,
      latestQr: this.latestQr,
      updatesGroupJid: this.updatesGroupJid ?? null
    };
  }

  private resolveLinkedPhone(): string | null {
    const fromSocket = formatLinkedPhone(this.sock?.user?.id);
    if (fromSocket) return fromSocket;
    try {
      const credsPath = path.join(this.sessionPath, 'creds.json');
      if (!fs.existsSync(credsPath)) return null;
      const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8')) as { me?: { id?: string } };
      return formatLinkedPhone(creds.me?.id);
    } catch {
      return null;
    }
  }

  /** Tear down the previous socket before a reconnect so listeners do not stack. */
  private async destroySocket(): Promise<void> {
    if (!this.sock) return;
    try {
      this.sock.ev.removeAllListeners('connection.update');
      this.sock.ev.removeAllListeners('creds.update');
      this.sock.ev.removeAllListeners('messages.upsert');
      this.sock.end(undefined);
    } catch (error) {
      logger.warn({ error }, 'Error while tearing down WhatsApp socket');
    }
    this.sock = null;
  }

  /**
   * Baileys can swallow post-connect init-query failures without emitting a
   * connection close event. The socket then looks alive but cannot process
   * WhatsApp traffic. Exit so the Windows launcher can restart cleanly.
   */
  private wrapLoggerForFatalInitQueries(): typeof logger {
    const base = logger;
    return new Proxy(base, {
      get(target, prop, _receiver) {
        const value = (target as any)[prop];
        if (prop !== 'error' || typeof value !== 'function') {
          return typeof value === 'function' ? value.bind(target) : value;
        }
        return (...args: any[]) => {
          const result = value.apply(target, args);
          const msg = args[args.length - 1];
          if (msg === "unexpected error in 'init queries'") {
            target.error('WhatsApp init-queries failed post-connect — restarting so the launcher can recover.');
            process.exit(1);
          }
          return result;
        };
      }
    }) as unknown as typeof logger;
  }

  private quarantineSession(reason: string): void {
    try {
      if (!fs.existsSync(this.sessionPath)) return;
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const dest = path.join(path.dirname(this.sessionPath), `sessions-quarantine-${stamp}`);
      fs.renameSync(this.sessionPath, dest);
      fs.mkdirSync(this.sessionPath, { recursive: true });
      logger.error({ dest, reason }, 'WhatsApp session quarantined — scan QR again on /link');
    } catch (error) {
      logger.error({ error, reason }, 'Failed to quarantine WhatsApp session');
    }
  }

  async start(): Promise<void> {
    if (this.starting) return;
    this.starting = true;
    try {
      await this.destroySocket();
      this.pairingRequested = false;
      fs.mkdirSync(this.sessionPath, { recursive: true });
      const { state, saveCreds } = await useMultiFileAuthState(this.sessionPath);

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
        logger: this.wrapLoggerForFatalInitQueries() as any,
        getMessage: async () => ({ conversation: '' }),
        // Post-connect props/blocklist/privacy-settings sync has been hanging
        // for 60s on every connect (server never answers the 'props' iq),
        // which was tripping the fatal-init-queries exit above on a loop.
        // We only relay group messages — none of that sync is needed.
        fireInitQueries: false
      });

      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.latestQr = qr;
          logger.info('QR Code received. Scan with WhatsApp (also on http://localhost:8787/link):');
          QRCode.generate(qr, { small: true });
          await this.maybeRequestPairingCode();
        }

        if (connection === 'close') {
          this.connected = false;
          // A QR belongs to the socket that emitted it. Never leave a dead QR
          // visible after that socket closes.
          this.latestQr = null;
          const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
          this.lastDisconnectStatus = statusCode ?? null;
          this.lastError = (lastDisconnect?.error as Error)?.message ?? 'Connection closed';
          const loggedOut = statusCode === DisconnectReason.loggedOut;
          const replaced = statusCode === DisconnectReason.connectionReplaced;
          const shouldReconnect = !loggedOut;

          logger.warn({ shouldReconnect, statusCode, error: lastDisconnect?.error, replaced }, 'Connection closed');

          if (loggedOut) {
            this.clearReconnectWatchdog();
            this.clearDisconnectExitTimer();
            this.quarantineSession('loggedOut');
            logger.error('Logged out from WhatsApp — exiting so the launcher restarts for a fresh QR.');
            process.exit(1);
          }

          if (replaced) {
            this.lastError = 'WhatsApp opened elsewhere (conflict). Close other linked sessions or wait for reconnect.';
          }

          // During initial pairing, Baileys closes/reopens sockets while QR
          // references rotate. Watchdogs are for linked sessions only.
          const registered = state.creds.registered;
          if (registered) this.armDisconnectExitTimer();

          // Do not count initial-pairing QR refreshes against the reconnect cap.
          if (shouldReconnect && (!registered || this.reconnectAttempts < this.maxReconnectAttempts)) {
            if (registered) this.reconnectAttempts++;
            logger.info({
              attempt: this.reconnectAttempts,
              maxAttempts: this.maxReconnectAttempts,
              delay: this.reconnectDelay
            }, 'Attempting to reconnect');

            if (registered) this.armReconnectWatchdog();
            setTimeout(() => {
              this.start().catch(error => {
                logger.error({ error }, 'Reconnect attempt threw — exiting so the launcher restarts a fresh process');
                process.exit(1);
              });
            }, this.reconnectDelay);
          } else if (registered && this.reconnectAttempts >= this.maxReconnectAttempts) {
            logger.error('Max reconnect attempts reached — exiting so the launcher restarts a fresh process.');
            process.exit(1);
          }
        }

        if (connection === 'open') {
          this.connected = true;
          this.reconnectAttempts = 0;
          this.latestQr = null;
          this.lastError = null;
          this.clearReconnectWatchdog();
          this.clearDisconnectExitTimer();
          logger.info('WhatsApp connection established successfully! 🎉');
        }
      });

      this.sock.ev.on('creds.update', saveCreds);

      this.sock.ev.on('messages.upsert', async ({ messages }) => {
        for (const msg of messages) {
          await this.handleIncomingMessage(msg);
        }
      });
    } catch (error) {
      this.lastError = (error as Error).message;
      logger.error({ error }, 'Failed to start WhatsApp bot');
      throw error;
    } finally {
      this.starting = false;
    }
  }

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

  private armDisconnectExitTimer(): void {
    if (this.disconnectExitTimer) return;
    this.disconnectExitTimer = setTimeout(() => {
      this.disconnectExitTimer = null;
      if (!this.connected) {
        logger.error({ windowMs: DISCONNECT_EXIT_MS }, 'Disconnected too long — exiting for launcher restart');
        process.exit(1);
      }
    }, DISCONNECT_EXIT_MS);
  }

  private clearDisconnectExitTimer(): void {
    if (this.disconnectExitTimer) {
      clearTimeout(this.disconnectExitTimer);
      this.disconnectExitTimer = null;
    }
  }

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
      if (msg.key.fromMe && msg.key.remoteJid?.endsWith('@g.us') && msg.key.remoteJid !== this.updatesGroupJid) {
        logger.info({ groupJid: msg.key.remoteJid }, 'Ignored message from non-whitelisted group');
      }

      if (msg.key.fromMe || msg.key.remoteJid === 'status@broadcast') return;

      if (this.updatesGroupJid && msg.key.remoteJid === this.updatesGroupJid) {
        const participant = msg.key.participant;
        if (!participant) return;
        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
        if (!text || !this.groupMessageHandler) return;
        const rawTimestamp = msg.messageTimestamp;
        const timestampSeconds = typeof rawTimestamp === 'number'
          ? rawTimestamp
          : Number(rawTimestamp?.toString() || '0');
        const receivedAt = timestampSeconds > 0
          ? new Date(timestampSeconds * 1000).toISOString()
          : new Date().toISOString();
        await this.groupMessageHandler(participant.split('@')[0], text, {
          externalMessageId: msg.key.id ?? undefined,
          replyToExternalId: msg.message?.extendedTextMessage?.contextInfo?.stanzaId ?? undefined,
          receivedAt
        });
        return;
      }

      if (msg.key.remoteJid?.endsWith('@g.us')) {
        logger.info({ groupJid: msg.key.remoteJid }, 'Ignored message from non-whitelisted group');
        return;
      }

      const messageText = msg.message?.conversation ||
                         msg.message?.extendedTextMessage?.text ||
                         '';

      if (!messageText) return;

      const from = msg.key.remoteJid || '';
      const phoneNumber = from.split('@')[0];

      if (this.messageHandler) {
        logger.info({ from: phoneNumber, message: messageText }, 'Message received');
        await this.messageHandler(phoneNumber, messageText);
      }
    } catch (error) {
      logger.error({ error, msg }, 'Error handling incoming message');
    }
  }

  onMessage(handler: (from: string, message: string) => Promise<void>): void {
    this.messageHandler = handler;
  }

  onGroupMessage(handler: (
    participant: string,
    message: string,
    metadata: IncomingGroupMessageMetadata
  ) => Promise<void>): void {
    this.groupMessageHandler = handler;
  }

  async sendMessage(to: string, message: string): Promise<boolean> {
    if (groupSendBlocked(to)) {
      logger.info({ to }, 'Group send blocked — GROUP_SILENT is on');
      return false;
    }
    if (!this.sock || !this.connected) {
      logger.error({ to }, 'Cannot send message: Not connected');
      return false;
    }

    try {
      const jid = to.includes('@') ? to : `${to.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
      await this.sock.sendMessage(jid, { text: message });
      logger.info({ to, message }, 'Message sent');
      return true;
    } catch (error) {
      logger.error({ error, to, message }, 'Failed to send message');
      return false;
    }
  }

  async sendDocument(to: string, filePath: string, caption?: string): Promise<boolean> {
    if (groupSendBlocked(to)) {
      logger.info({ to, filePath }, 'Group document send blocked — GROUP_SILENT is on');
      return false;
    }
    if (!this.sock || !this.connected) {
      logger.error({ to, filePath }, 'Cannot send document: Not connected');
      return false;
    }

    const MIMETYPES: Record<string, string> = {
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.pdf': 'application/pdf'
    };

    try {
      const jid = to.includes('@') ? to : `${to.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
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
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  isConnected(): boolean {
    return this.connected;
  }

  async disconnect(): Promise<void> {
    this.clearReconnectWatchdog();
    this.clearDisconnectExitTimer();
    if (this.sock) {
      try {
        await this.sock.logout();
      } catch {
        await this.destroySocket();
      }
      this.sock = null;
      this.connected = false;
      logger.info('WhatsApp bot disconnected');
    }
  }
}
