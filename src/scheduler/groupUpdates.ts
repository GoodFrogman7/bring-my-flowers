import * as cron from 'node-cron';
import { BusinessDb } from '../business/db';
import { MessageSender } from '../bot/messageSender';
import { OllamaClient } from '../llm/ollama';
import { processGroupMessages, formatGroupSummary } from '../business/groupUpdates';
import { writeDelSheetDetailed } from '../business/delSheet';
import { autoRenewDueSubscriptions, flagDormantForReview } from '../business/renewal';
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
   * Optional personal DMs of the nightly sheet. Default off.
   * OWNER_SHEET_DM=1 required.
   */
  ownerDm?: string[];
  today?: () => string;
}

/** Personal sheet DMs are off unless OWNER_SHEET_DM is explicitly enabled. */
export function ownerSheetDmEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.OWNER_SHEET_DM || '0').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

/**
 * Auto-posting the .xlsx into the Updates group is on by default (staff pull
 * from the group; owner uses the dashboard). Set GROUP_SHEET_SEND=0 to disable.
 */
export function groupSheetSendEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.GROUP_SHEET_SEND ?? '1').trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'no') return false;
  return raw === '1' || raw === 'true' || raw === 'yes' || env.GROUP_SHEET_SEND === undefined;
}

/**
 * Nightly auto-summary text in the Updates group. Off by default so the bot
 * stays quiet unless invoked. Set GROUP_NIGHTLY_SUMMARY=1 to re-enable.
 */
export function groupNightlySummaryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.GROUP_NIGHTLY_SUMMARY || '0').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

function cronFor(time: string): string {
  const [hour, minute] = time.split(':').map(Number);
  return `${minute} ${hour} * * *`;
}

/** The business runs on IST regardless of where the host laptop's clock is set. */
const TIMEZONE = 'Asia/Kolkata';

/**
 * Nightly job: apply staged Updates-group messages, regenerate tomorrow's
 * delivery sheet on disk for the owner dashboard, and post the .xlsx to the
 * Updates group by default. Personal owner DMs stay off unless OWNER_SHEET_DM=1.
 * On-demand "Bot, send sheet" is handled live by GroupAssistant.
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

    // Real customers essentially never text "renew" — the owner just keeps
    // extending everyone by default. Without this, subscriptions silently
    // stop appearing on the sheet the moment their current cycle runs out.
    const renewal = autoRenewDueSubscriptions(db, today);
    if (renewal.flagged.length > 0) {
      const newlyFlagged = flagDormantForReview(db, renewal.flagged, new Date().toISOString());
      logger.warn(
        { flagged: renewal.flagged.length, newlyFlagged },
        'Subscriptions dormant beyond the auto-renew window — surfaced on the dashboard Review queue'
      );
    }

    const outPath = `${delSheetDir ?? './data'}/del-sheet-${tomorrow}.xlsx`;
    const sheet = writeDelSheetDetailed(db, tomorrow, outPath);

    const caption = `Delivery sheet for ${tomorrow} — ${sheet.rows} rows, ${sheet.autoAssigned} auto-assigned` +
      (sheet.manual.length > 0 ? `, ${sheet.manual.length} manual (see Procurement tab)` : '');

    if (groupNightlySummaryEnabled()) {
      await sender.sendMessage(groupJid, formatGroupSummary(result, today));
    }

    if (groupSheetSendEnabled()) {
      if (sender.sendDocument) {
        const sent = await sender.sendDocument(groupJid, outPath, caption);
        if (!sent) await sender.sendMessage(groupJid, `${caption}\n(file send failed — saved at ${outPath})`);
      } else {
        await sender.sendMessage(groupJid, `${caption}\n→ ${outPath}`);
      }
    }

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
      autoRenewed: renewal.renewed.length,
      autoRenewFlagged: renewal.flagged.length,
      sheetRows: sheet.rows,
      sheetPath: outPath,
      groupSheetSend: groupSheetSendEnabled(),
      groupNightlySummary: groupNightlySummaryEnabled(),
      ownerDm: dmOwners.length
    }, 'Group updates run complete (sheet on disk for dashboard)');
  }
}
