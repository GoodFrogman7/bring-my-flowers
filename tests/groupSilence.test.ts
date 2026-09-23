import { describe, it, expect, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { groupSendBlocked, groupSilentEnabled, isGroupJid } from '../src/bot/groupSilence';
import { WhatsAppBot } from '../src/bot/whatsapp';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('groupSilentEnabled', () => {
  it('is on unless explicitly turned off', () => {
    expect(groupSilentEnabled({})).toBe(true);
    expect(groupSilentEnabled({ GROUP_SILENT: '1' })).toBe(true);
    expect(groupSilentEnabled({ GROUP_SILENT: '' })).toBe(true);
    expect(groupSilentEnabled({ GROUP_SILENT: 'anything' })).toBe(true);
    expect(groupSilentEnabled({ GROUP_SILENT: '0' })).toBe(false);
    expect(groupSilentEnabled({ GROUP_SILENT: ' false ' })).toBe(false);
    expect(groupSilentEnabled({ GROUP_SILENT: 'NO' })).toBe(false);
  });

  it('blocks group JIDs only', () => {
    expect(isGroupJid('120363000000000000@g.us')).toBe(true);
    expect(isGroupJid('919999999999@s.whatsapp.net')).toBe(false);
    expect(isGroupJid('+919999999999')).toBe(false);
    expect(groupSendBlocked('120363000000000000@g.us', {})).toBe(true);
    expect(groupSendBlocked('919999999999@s.whatsapp.net', {})).toBe(false);
    expect(groupSendBlocked('120363000000000000@g.us', { GROUP_SILENT: '0' })).toBe(false);
  });
});

describe('WhatsAppBot transport guard', () => {
  function connectedBot(): { bot: WhatsAppBot; socketSends: string[] } {
    const socketSends: string[] = [];
    const bot = new WhatsAppBot(path.join(os.tmpdir(), 'bmf-no-session'));
    // Stand in for a live Baileys socket without connecting to WhatsApp.
    Object.assign(bot as unknown as Record<string, unknown>, {
      connected: true,
      sock: { sendMessage: async (jid: string) => { socketSends.push(jid); } }
    });
    return { bot, socketSends };
  }

  it('refuses every group send while silent (default), text and documents', async () => {
    const { bot, socketSends } = connectedBot();
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bmf-silence-')), 'sheet.xlsx');
    fs.writeFileSync(file, 'x');

    expect(await bot.sendMessage('120363000000000000@g.us', 'hello group')).toBe(false);
    expect(await bot.sendDocument('120363000000000000@g.us', file, 'sheet')).toBe(false);
    expect(socketSends).toHaveLength(0);

    // Personal chats are not affected by the group switch.
    expect(await bot.sendMessage('919999999999', 'hello owner')).toBe(true);
    expect(socketSends).toEqual(['919999999999@s.whatsapp.net']);
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  });

  it('allows group sends only with GROUP_SILENT=0', async () => {
    vi.stubEnv('GROUP_SILENT', '0');
    const { bot, socketSends } = connectedBot();
    expect(await bot.sendMessage('120363000000000000@g.us', 'hello group')).toBe(true);
    expect(socketSends).toEqual(['120363000000000000@g.us']);
  });
});
