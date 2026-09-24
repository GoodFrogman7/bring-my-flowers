/**
 * Export every Updates-group message with IST timestamps, reply links, and
 * what the pipeline did with it (group_update_log). Read-only; refuses the
 * live database — run it on a copy.
 *
 *   npx ts-node scripts/evidence/export-group-messages.ts <db-copy> <out.csv>
 *
 * Sender numbers are masked. Message text is exported as-is (it is the
 * evidence), so keep the CSV out of Git.
 */
import * as fs from 'fs';
import * as path from 'path';
import { istTimestamp, maskPhones } from './attribution';
import { loadEvidenceMessages, openEvidenceCopy } from './evidenceDb';

const csv = (value: unknown) => {
  const s = String(value ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function main(): void {
  const [dbPath, outPath] = process.argv.slice(2);
  if (!dbPath || !outPath) {
    console.error('Usage: npx ts-node scripts/evidence/export-group-messages.ts <db-copy> <out.csv>');
    process.exit(1);
  }
  const db = openEvidenceCopy(dbPath);
  const messages = loadEvidenceMessages(db);
  db.close();

  const header = ['id', 'received_ist', 'sender', 'reply_to', 'text', 'classification', 'action_taken', 'escalated', 'escalation_reason', 'resolved_ist', 'processed_ist'];
  const lines = [header.join(',')];
  for (const m of messages) {
    lines.push([
      m.id,
      istTimestamp(m.receivedAt),
      maskPhones(m.participant.replace(/@.*/, '')),
      m.replyToExternalId,
      m.text,
      m.classification ?? 'NOT_PROCESSED',
      m.actionTaken,
      m.escalated ? 'yes' : 'no',
      m.reason,
      m.resolvedAt ? istTimestamp(m.resolvedAt) : '',
      m.processedAt ? istTimestamp(m.processedAt) : ''
    ].map(csv).join(','));
  }
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(outPath, '\uFEFF' + lines.join('\r\n')); // BOM so Excel reads ₹ and Hindi correctly
  console.log(`Exported ${messages.length} group messages to ${outPath}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
