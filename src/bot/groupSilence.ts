/**
 * Silent-listener mode for the WhatsApp Updates group.
 *
 * The bot stores every group message for the nightly run and the dashboard,
 * but posts nothing back to any group. This is the single switch for that:
 * the Baileys transport refuses every group send while it is on, so no
 * scheduler, command, or future code path can re-enable posting by accident.
 * Questions belong in the owner console; the sheet is downloaded there.
 *
 * On by default. Only GROUP_SILENT=0/false/no turns group posting back on.
 */
export function groupSilentEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = (env.GROUP_SILENT ?? '1').trim().toLowerCase();
  return !(raw === '0' || raw === 'false' || raw === 'no');
}

/** WhatsApp group JIDs end in @g.us; personal chats use @s.whatsapp.net. */
export function isGroupJid(jid: string): boolean {
  return /@g\.us$/i.test(jid.trim());
}

/** True when a send to this recipient must be dropped. */
export function groupSendBlocked(to: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return isGroupJid(to) && groupSilentEnabled(env);
}
