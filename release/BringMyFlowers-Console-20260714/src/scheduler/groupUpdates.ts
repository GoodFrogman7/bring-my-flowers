import * as cron from 'node-cron';
import { BusinessDb } from '../business/db';
import { MessageSender } from '../bot/messageSender';
import { OllamaClient } from '../llm/ollama';
import { processGroupMessages, formatGroupSummary } from '../business/groupUpdates';
import { writeDelSheetDetailed } from '../business/delSheet';
import { todayIST, addDays } from '../business/dates';
import logger from '../utils/logger';

export interface GroupUpdatesOptions {
  db: BusinessDb;
  sender: MessageSender;
  groupJid: string;
  ollama?: OllamaClient;
  delSheetDir?: string;
  /** HH:mm IST — after the day's group chatter, before staff pull tomorrow's sheet. */
  processTime?: string;
  /**
   * Optional personal DMs of the nightly sheet. Default is off — the owner
   * dashboard is the sheet home. Set OWNER_SHEET_DM=1 to re-enable.
   */
  ownerDm?: string[];
  today?: () => string;
}

/** Personal sheet DMs are off unless OWNER_SHEET_DM is explicitly "1"/"true". */
export function ownerSheetDmEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.OWNER_SHEET_DM || '0').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

function cronFor(time: string): string {
  const [hour, minute] = time.split(':').map(Number);
  return `${minute} ${hour} * * *`;
}

/** The business runs on IST regardless of where the host laptop's clock is set. */
const TIMEZONE = 'Asia/Kolkata';

/**
 * Nightly summarizer for the "Updates" WhatsApp group: applies what the day's
 * messages clearly resolve to, regenerates tomorrow's delivery sheet, and
 * posts a same-group summary so staff can cross-verify against the Master
 * sheet before the morning delivery run. Not a live system — see
 * src/business/groupUpdates.ts for the classify/apply logic.
 */
export class GroupUpdatesScheduler {
  private job: cron.ScheduledTask | null = null;
  private today: () => string;

  constructor(private options: GroupUpdatesOptions) {
    this.today = options.today ?? todayIST;
  }

  start(): void {
    const processTime = this.options.processTime || '21:30';
    this.job = cron.schedule(cronFor(processTime), async () => {
      logger.info('Group-updates processing triggered');
      await this.runOnce();
    }, { timezone: TIMEZONE });
    logger.info({ processTime, timezone: TIMEZONE }, 'Group updates scheduler started');
  }

  stop(): void {
    this.job?.stop();
    this.job = null;
    logger.info('Group updates scheduler stopped');
  }

  async runOnce(): Promise<void> {
    const { db, sender, groupJid, ollama, delSheetDir, ownerDm } = this.options;
    const today = this.today();
    const tomorrow = addDays(today, 1);

    const result = await processGroupMessages(db, today, ollama);
    // Always regenerate and send tomorrow's sheet — the group expects the file
    // every night, even on days with no updates to apply.
    const outPath = `${delSheetDir ?? './data'}/del-sheet-${tomorrow}.xlsx`;
    const sheet = writeDelSheetDetailed(db, tomorrow, outPath);

    const summary = formatGroupSummary(result, today);
    await sender.sendMessage(groupJid, summary);

    const caption = `📋 Delivery sheet for ${tomorrow} — ${sheet.rows} rows, ${sheet.autoAssigned} auto-assigned` +
      (sheet.manual.length > 0 ? `, ${sheet.manual.length} manual (see Procurement tab)` : '');
    if (sender.sendDocument) {
      const sent = await sender.sendDocument(groupJid, outPath, caption);
      if (!sent) await sender.sendMessage(groupJid, `${caption}\n(⚠️ file send failed — it is saved at ${outPath})`);
    } else {
      await sender.sendMessage(groupJid, `${caption}\n→ ${outPath}`);
    }

    // Personal DMs are opt-in. By default the sheet lives in the Updates group
    // and on the owner dashboard — never as a 1:1 WhatsApp attachment.
    const dmOwners = ownerSheetDmEnabled() ? (ownerDm ?? []) : [];
    for (const owner of dmOwners) {
      if (sender.sendDocument) {
        const sent = await sender.sendDocument(owner, outPath, caption);
        if (!sent) logger.error({ owner, outPath }, 'Failed to DM nightly sheet to owner');
      }
    }
    logger.info({
      ...result,
      escalated: result.escalated.length,
      sheetRows: sheet.rows,
      ownerDm: dmOwners.length,
      ownerSheetDmEnabled: ownerSheetDmEnabled()
    }, 'Group updates run complete');
  }
}
