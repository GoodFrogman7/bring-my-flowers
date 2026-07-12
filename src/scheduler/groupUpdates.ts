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
  /** HH:mm — after the day's group chatter, before staff pull tomorrow's sheet. */
  processTime?: string;
  today?: () => string;
}

function cronFor(time: string): string {
  const [hour, minute] = time.split(':').map(Number);
  return `${minute} ${hour} * * *`;
}

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
    });
    logger.info({ processTime }, 'Group updates scheduler started');
  }

  stop(): void {
    this.job?.stop();
    this.job = null;
    logger.info('Group updates scheduler stopped');
  }

  async runOnce(): Promise<void> {
    const { db, sender, groupJid, ollama, delSheetDir } = this.options;
    const today = this.today();
    const tomorrow = addDays(today, 1);

    const result = await processGroupMessages(db, today, ollama);
    if (result.processed > 0) {
      const outPath = `${delSheetDir ?? './data'}/del-sheet-${tomorrow}.xlsx`;
      writeDelSheetDetailed(db, tomorrow, outPath);
    }

    const summary = formatGroupSummary(result, today);
    await sender.sendMessage(groupJid, summary);
    logger.info({ ...result, escalated: result.escalated.length }, 'Group updates run complete');
  }
}
