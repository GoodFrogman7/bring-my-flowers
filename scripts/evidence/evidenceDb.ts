/**
 * Read-only access to a COPY of business.db for the Phase 1 evidence
 * harness. Refuses the live database file outright: copy it first.
 */
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { CustomerRef, EvidenceMessage } from './attribution';

/** Paths the running app may be using right now. */
export function liveDbPaths(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): string[] {
  const candidates = [path.resolve(cwd, 'data/business.db')];
  if (env.BUSINESS_DB) candidates.push(path.resolve(cwd, env.BUSINESS_DB));
  return candidates.map(p => (fs.existsSync(p) ? fs.realpathSync(p) : p));
}

export function assertNotLiveDb(dbPath: string, env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): void {
  const resolved = path.resolve(cwd, dbPath);
  const target = fs.existsSync(resolved) ? fs.realpathSync(resolved) : resolved;
  if (liveDbPaths(env, cwd).includes(target)) {
    throw new Error(`Refusing to analyse the live database (${target}). Copy it first, e.g. copy data\\business.db C:\\temp\\business-copy.db`);
  }
}

export function openEvidenceCopy(dbPath: string): Database.Database {
  assertNotLiveDb(dbPath);
  return new Database(dbPath, { readonly: true, fileMustExist: true });
}

/** Every group message with what the pipeline did with it (latest log row wins). */
export function loadEvidenceMessages(db: Database.Database): Array<EvidenceMessage & { replyToExternalId: string; processedAt: string | null; reason: string }> {
  const rows = db.prepare(`
    SELECT m.id, m.participant, m.message_text, m.received_at, m.reply_to_external_id, m.processed_at,
           l.classification, l.action_taken, l.escalated, l.escalation_reason, l.resolved_at, l.matched_customer_id
    FROM group_messages m
    LEFT JOIN group_update_log l ON l.id = (SELECT MAX(id) FROM group_update_log WHERE message_id = m.id)
    WHERE m.participant <> 'dashboard'
    ORDER BY m.received_at, m.id
  `).all() as Array<Record<string, string | number | null>>;
  return rows.map(r => ({
    id: Number(r.id),
    participant: String(r.participant ?? ''),
    text: String(r.message_text ?? ''),
    receivedAt: String(r.received_at ?? ''),
    replyToExternalId: String(r.reply_to_external_id ?? ''),
    processedAt: r.processed_at === null ? null : String(r.processed_at),
    classification: r.classification === null ? null : String(r.classification),
    actionTaken: String(r.action_taken ?? ''),
    escalated: Number(r.escalated ?? 0) === 1,
    reason: String(r.escalation_reason ?? ''),
    resolvedAt: r.resolved_at === null || r.resolved_at === undefined ? null : String(r.resolved_at),
    matchedCustomerId: r.matched_customer_id === null || r.matched_customer_id === undefined ? null : String(r.matched_customer_id)
  }));
}

export function loadCustomers(db: Database.Database): Map<string, CustomerRef> {
  const out = new Map<string, CustomerRef>();
  for (const r of db.prepare(`SELECT id, name, phones FROM customers`).all() as Array<{ id: string; name: string; phones: string }>) {
    out.set(r.id.toUpperCase(), { id: r.id, name: r.name, phones: r.phones.split('//').map(p => p.replace(/\D/g, '')).filter(Boolean) });
  }
  return out;
}
