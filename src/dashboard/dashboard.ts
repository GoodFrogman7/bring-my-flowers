import express from 'express';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import QRCode from 'qrcode';
import { BusinessDb } from '../business/db';
import { dueRows, writeDelSheetDetailed } from '../business/delSheet';
import { renewalsDue } from '../business/paymentRun';
import { formatGroupSummary } from '../business/groupUpdates';
import { addDays, todayIST } from '../business/dates';
import { WhatsAppHealth } from '../bot/whatsapp';
import { DASHBOARD_HTML, LINK_HTML, LOGIN_HTML } from './page';
import { ARCHITECTURE_HTML } from './architecture';
import {
  BusinessOpsRunResult,
  groupNightlySummaryEnabled,
  groupSheetSendEnabled,
  ownerSheetDmEnabled
} from '../scheduler/groupUpdates';
import logger from '../utils/logger';

/**
 * Owner dashboard: deliveries, pending collections, the manual-review queue,
 * pasted update intake, sheet downloads, optional WhatsApp link/status, and a
 * chat box wired to the same Q&A chain as the WhatsApp group.
 *
 * Binds to 127.0.0.1 only by default. Setting CONSOLE_PASSWORD opts into
 * binding on the LAN instead (so it's reachable from a phone on the same
 * WiFi, installable as a home-screen app) — every route then requires a
 * password-gated session cookie first.
 */

export interface DashboardOptions {
  db: BusinessDb;
  answer: (question: string, today: string) => Promise<string>;
  /** Prefer this when available — includes answer mode chip. */
  answerDetailed?: (question: string, today: string) => Promise<{ answer: string; mode: string }>;
  port: number;
  delSheetDir?: string;
  today?: () => string;
  qaMode?: string;
  /** Live WhatsApp health from the Baileys bot (optional for sandbox/dev). */
  getWhatsAppHealth?: () => WhatsAppHealth | null;
  sessionPath?: string;
  updatesGroupJid?: string | null;
  /** Primary input mode for the owner console. WhatsApp is optional in dashboard mode. */
  inputMode?: 'whatsapp' | 'dashboard';
  /** Safe manual fallback/primary intake for staff updates. */
  manualUpdates?: {
    stage: (text: string) => number;
    apply: () => Promise<BusinessOpsRunResult>;
  };
}

const DASHBOARD_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="28" fill="#1a2e28"/>
  <path d="M64 28c8 12 10 24 5.5 32.5C81 57 93 59 102 68c-12 2-22-.8-29.5-7 2.8 10 .9 21-7.5 34.5-8.4-13.5-10.3-24.5-7.5-34.5C50.5 67.2 40.5 70 28.5 68c9-9 21-11 32.5-7.5C56 52 58 40 64 28z" fill="#f3d9c4"/>
  <circle cx="64" cy="62" r="8" fill="#c45c6a"/>
</svg>`;

function suggestedAction(classification: string, reason: string): string {
  const r = reason.toLowerCase();
  if (r.includes('ambiguous')) return 'Pick the correct customer in your Master sheet / WhatsApp Updates, then mark handled.';
  if (r.includes('no customer')) return 'Confirm the name spelling or create the customer, then re-post a clear update.';
  if (r.includes('incomplete order') || r.includes('missing')) return 'Ask staff for phone, address, date, and product details in one message.';
  if (r.includes('combined')) return 'Split into separate Updates messages (one action each).';
  if (r.includes('dormant')) return 'Check with the customer/owner if still active — reply "renew <id>" to resume, or mark the subscription closed in the Master.';
  if (r.includes('subscription')) return 'Confirm pack and start day with the owner, then apply manually.';
  if (classification === 'UNCLEAR') return 'Clarify with staff in the Updates group, then mark handled.';
  return 'Handle in the Updates group or Master sheet, then mark handled.';
}

export function startDashboard(options: DashboardOptions): http.Server {
  const { db, answer } = options;
  const today = options.today ?? todayIST;
  const delSheetDir = options.delSheetDir ?? './data';
  const sessionPath = options.sessionPath ?? './sessions';
  const inputMode = options.inputMode ?? 'whatsapp';
  const whatsappRequired = inputMode !== 'dashboard';
  let manualApplyInFlight = false;

  const app = express();
  app.use(express.json());

  // Opt-in LAN/mobile access. Without CONSOLE_PASSWORD set, behavior is
  // unchanged (127.0.0.1 only, no login) — this never weakens the default.
  const consolePassword = (process.env.CONSOLE_PASSWORD || '').trim();
  const mobileAccessEnabled = consolePassword.length > 0;
  const sessions = new Set<string>();
  const SESSION_COOKIE = 'bmf_session';

  const parseCookies = (header?: string): Record<string, string> => {
    const out: Record<string, string> = {};
    (header || '').split(';').forEach(part => {
      const i = part.indexOf('=');
      if (i === -1) return;
      const key = part.slice(0, i).trim();
      if (key) out[key] = decodeURIComponent(part.slice(i + 1).trim());
    });
    return out;
  };

  if (mobileAccessEnabled) {
    app.get('/login', (_req, res) => {
      res.type('html').send(LOGIN_HTML);
    });
    app.post('/api/login', (req, res) => {
      const password = String(req.body?.password || '');
      if (password !== consolePassword) {
        return res.status(401).json({ error: 'Wrong password' });
      }
      const token = crypto.randomBytes(24).toString('hex');
      sessions.add(token);
      res.cookie(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 90 * 24 * 60 * 60 * 1000
      });
      res.json({ ok: true });
    });
    app.use((req, res, next) => {
      if (req.path === '/login' || req.path === '/api/login' || req.path === '/icon.svg' || req.path === '/manifest.webmanifest') {
        return next();
      }
      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
      if (token && sessions.has(token)) return next();
      if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Not signed in' });
      return res.redirect('/login');
    });
  }

  const buildHealth = () => {
    const wa = options.getWhatsAppHealth?.() ?? null;
    const linked = wa?.linked ?? fs.existsSync(path.join(sessionPath, 'creds.json'));
    const connected = wa?.connected ?? false;
    const groupConfigured = Boolean(options.updatesGroupJid || wa?.updatesGroupJid);
    return {
      ok: !whatsappRequired || (connected && linked && groupConfigured),
      inputMode,
      whatsappRequired,
      manualUpdatesEnabled: Boolean(options.manualUpdates),
      whatsappConnected: connected,
      linked,
      phoneNumber: wa?.phoneNumber ?? null,
      updatesGroupConfigured: groupConfigured,
      updatesGroupJid: options.updatesGroupJid || wa?.updatesGroupJid || null,
      lastError: wa?.lastError ?? null,
      lastDisconnectStatus: wa?.lastDisconnectStatus ?? null,
      reconnectAttempts: wa?.reconnectAttempts ?? 0,
      hasQr: Boolean(wa?.latestQr),
      qaMode: options.qaMode ?? 'Local tools',
      ownerSheetDm: ownerSheetDmEnabled(),
      groupSheetSend: groupSheetSendEnabled(),
      groupNightlySummary: groupNightlySummaryEnabled()
    };
  };

  app.get('/', (_req, res) => {
    res.type('html').send(DASHBOARD_HTML);
  });

  app.get('/link', (_req, res) => {
    res.type('html').send(LINK_HTML);
  });

  app.get('/architecture', (_req, res) => {
    res.type('html').send(ARCHITECTURE_HTML);
  });

  app.use('/assets', express.static(path.resolve('docs/assets')));

  app.get('/manifest.webmanifest', (_req, res) => {
    res.json({
      name: 'Bring My Flowers',
      short_name: 'BMF',
      description: 'Owner dashboard for Bring My Flowers deliveries and payments',
      start_url: '/',
      display: 'standalone',
      background_color: '#eef3f0',
      theme_color: '#1a2e28',
      icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }]
    });
  });

  app.get('/icon.svg', (_req, res) => {
    res.type('image/svg+xml').send(DASHBOARD_ICON_SVG);
  });

  app.get('/api/health', (_req, res) => {
    res.json(buildHealth());
  });

  app.post('/api/updates', (req, res) => {
    if (!options.manualUpdates) {
      res.status(404).json({ error: 'Manual updates are not enabled.' });
      return;
    }
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text) {
      res.status(400).json({ error: 'Paste an update before saving it.' });
      return;
    }
    if (text.length > 12000) {
      res.status(400).json({ error: 'That update is too long. Split it into smaller messages.' });
      return;
    }
    try {
      const id = options.manualUpdates.stage(text);
      res.status(201).json({ staged: true, id });
    } catch (error) {
      logger.error({ error }, 'Manual update staging failed');
      res.status(500).json({ error: 'Could not save the update â€” check the logs.' });
    }
  });

  app.post('/api/updates/apply', async (_req, res) => {
    if (!options.manualUpdates) {
      res.status(404).json({ error: 'Manual updates are not enabled.' });
      return;
    }
    if (manualApplyInFlight) {
      res.status(409).json({ error: 'An update run is already in progress. Wait a moment and refresh.' });
      return;
    }
    manualApplyInFlight = true;
    try {
      const result = await options.manualUpdates.apply();
      res.json({ ...result, summary: formatGroupSummary(result, today()) });
    } catch (error) {
      logger.error({ error }, 'Manual update apply failed');
      res.status(500).json({ error: 'Could not apply updates â€” check the logs.' });
    } finally {
      manualApplyInFlight = false;
    }
  });

  app.get('/api/qr', async (_req, res) => {
    const wa = options.getWhatsAppHealth?.();
    if (!wa?.latestQr) {
      res.status(404).json({ error: 'No QR available — WhatsApp may already be linked, or the bot is still starting.' });
      return;
    }
    try {
      const dataUrl = await QRCode.toDataURL(wa.latestQr, { width: 320, margin: 2 });
      res.json({ qr: dataUrl, connected: wa.connected, linked: wa.linked });
    } catch (error) {
      logger.error({ error }, 'QR render failed');
      res.status(500).json({ error: 'Could not render QR' });
    }
  });

  app.get('/api/overview', (_req, res) => {
    const now = today();
    const summarize = (date: string) => {
      const rows = dueRows(db, date);
      const byZone: Record<string, number> = {};
      for (const row of rows) byZone[row.zone || '?'] = (byZone[row.zone || '?'] ?? 0) + 1;
      return {
        date,
        count: rows.length,
        revenue: rows.reduce((sum, row) => sum + row.revenue, 0),
        collect: rows.reduce((sum, row) => sum + (row.collect === '' ? 0 : row.collect), 0),
        byZone
      };
    };
    const pendingTotal = (db.prepare(`
      SELECT COALESCE(SUM(cy.collect), 0) AS total FROM cycles cy
      JOIN subscriptions s ON cy.subscription_id = s.id
      WHERE cy.payment_status = 'PENDING' AND cy.collect > 0 AND s.status = 'ACTIVE'
    `).get() as { total: number }).total;
    const reviewCount = (db.prepare(`
      SELECT COUNT(*) AS n FROM group_update_log WHERE escalated = 1 AND resolved_at IS NULL
    `).get() as { n: number }).n;
    const staged = (db.prepare(`
      SELECT COUNT(*) AS n FROM group_messages WHERE processed_at IS NULL
    `).get() as { n: number }).n;
    const customerCount = (db.prepare(`SELECT COUNT(*) AS n FROM customers`).get() as { n: number }).n;
    const activeSubs = (db.prepare(`SELECT COUNT(*) AS n FROM subscriptions WHERE status = 'ACTIVE'`).get() as { n: number }).n;
    const health = buildHealth();
    res.json({
      today: summarize(now),
      tomorrow: summarize(addDays(now, 1)),
      pendingCollections: pendingTotal,
      renewalsDue: renewalsDue(db, now).length,
      reviewCount,
      stagedUpdates: staged,
      customerCount,
      activeSubscriptions: activeSubs,
      qaMode: options.qaMode ?? 'Local read-only tools',
      inputMode,
      whatsappRequired,
      manualUpdatesEnabled: Boolean(options.manualUpdates),
      health
    });
  });

  app.get('/api/deliveries', (req, res) => {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date)) ? String(req.query.date) : today();
    const rows = dueRows(db, date);
    res.json({
      date,
      deliveries: rows.map(row => ({
        id: row.id,
        name: row.name,
        zone: row.zone,
        timeSlot: row.timeSlot,
        package: row.packageName,
        revenue: row.revenue,
        collect: row.collect === '' ? 0 : row.collect
      }))
    });
  });

  app.get('/api/collections', (_req, res) => {
    const rows = db.prepare(`
      SELECT c.id, c.name, c.zone, c.phones, SUM(cy.collect) AS owed
      FROM cycles cy
      JOIN subscriptions s ON cy.subscription_id = s.id
      JOIN customers c ON s.customer_id = c.id
      WHERE cy.payment_status = 'PENDING' AND cy.collect > 0 AND s.status = 'ACTIVE'
      GROUP BY c.id ORDER BY owed DESC LIMIT 25
    `).all() as Array<{ id: string; name: string; zone: string; phones: string; owed: number }>;
    const total = rows.reduce((sum, row) => sum + row.owed, 0);
    res.json({ total, debtors: rows.map(row => ({ ...row, phones: row.phones.split('//')[0] ?? '' })) });
  });

  app.get('/api/renewals', (_req, res) => {
    res.json({ renewals: renewalsDue(db, today()) });
  });

  app.get('/api/review', (_req, res) => {
    const items = db.prepare(`
      SELECT l.id, l.message_id, m.message_text, m.participant, m.received_at,
             l.classification, l.action_taken, l.escalation_reason, l.created_at
      FROM group_update_log l JOIN group_messages m ON m.id = l.message_id
      WHERE l.escalated = 1 AND l.resolved_at IS NULL
      ORDER BY l.id DESC LIMIT 100
    `).all() as Array<{
      id: number; message_id: number; message_text: string; participant: string;
      received_at: string; classification: string; action_taken: string;
      escalation_reason: string; created_at: string;
    }>;
    res.json({
      items: items.map(item => ({
        ...item,
        suggestedAction: suggestedAction(item.classification, item.escalation_reason || item.action_taken)
      }))
    });
  });

  app.post('/api/review/:id/resolve', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'invalid id' });
      return;
    }
    const result = db.prepare(`
      UPDATE group_update_log SET resolved_at = ? WHERE id = ? AND escalated = 1 AND resolved_at IS NULL
    `).run(new Date().toISOString(), id);
    res.json({ resolved: result.changes === 1 });
  });

  app.post('/api/chat', async (req, res) => {
    const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
    if (!question) {
      res.status(400).json({ error: 'question is required' });
      return;
    }
    try {
      if (options.answerDetailed) {
        const result = await options.answerDetailed(question, today());
        res.json(result);
        return;
      }
      res.json({ answer: await answer(question, today()), mode: 'unknown' });
    } catch (error) {
      logger.error({ error, question }, 'Dashboard chat failed');
      res.status(500).json({ error: 'Answering failed — check the logs.' });
    }
  });

  app.get('/api/sheet', (req, res) => {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.date)) ? String(req.query.date) : addDays(today(), 1);
    try {
      const outPath = path.resolve(delSheetDir, `del-sheet-${date}.xlsx`);
      writeDelSheetDetailed(db, date, outPath);
      res.download(outPath, `del-sheet-${date}.xlsx`);
    } catch (error) {
      logger.error({ error, date }, 'Dashboard sheet generation failed');
      res.status(500).json({ error: 'Sheet generation failed — check the logs or close the open Excel file.' });
    }
  });

  const server = http.createServer(app);
  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      logger.error({ port: options.port }, `Dashboard port ${options.port} is already in use — close the other process and restart`);
      console.error(`\n❌ Port ${options.port} is busy. Close the other Bring My Flowers window and try again.\n`);
      process.exit(1);
    }
    logger.error({ error }, 'Dashboard server error');
  });
  const bindHost = mobileAccessEnabled ? '0.0.0.0' : '127.0.0.1';
  server.listen(options.port, bindHost, () => {
    logger.info({ port: options.port }, `✓ Owner dashboard at http://localhost:${options.port}`);
    if (mobileAccessEnabled) {
      const lanIps = Object.entries(os.networkInterfaces())
        .filter(([name]) => !/vEthernet|Loopback|WSL|Virtual|Hyper-V|Docker/i.test(name))
        .flatMap(([, addrs]) => addrs ?? [])
        .filter((i): i is os.NetworkInterfaceInfo => !!i && i.family === 'IPv4' && !i.internal)
        .map(i => i.address);
      for (const ip of lanIps) {
        logger.info({ url: `http://${ip}:${options.port}` }, '✓ Reachable on your phone (same WiFi) at');
        console.log(`📱 On your phone (same WiFi): http://${ip}:${options.port}`);
      }
      if (lanIps.length === 0) {
        logger.warn('CONSOLE_PASSWORD is set but no LAN IPv4 address was found — phone access may not work');
      }
    }
  });
  return server;
}
