import { BusinessDb } from './db';
import { MessageSender } from '../bot/messageSender';
import { OllamaClient } from '../llm/ollama';
import { parseInstruction, Instruction } from './instructions';
import { applyInstruction, findCustomerByPhone, appendRemark, CustomerRecord } from './actions';
import { buildPaymentMessages, renewalsDue } from './paymentRun';
import { createNextCycle } from './renewal';
import { writeDelSheetDetailed, dueRows } from './delSheet';
import { writeMasterView } from './exportMaster';
import { todayIST, addDays } from './dates';
import { samePhone } from '../utils/ids';
import logger from '../utils/logger';

/**
 * Message router for the real business. Customers get the deterministic
 * instruction engine (LLM only classifies what regex misses, and anything
 * still unclear escalates to a human — never silently dropped). Staff numbers
 * get an ops command channel over the same datastore.
 */

export interface BusinessHandlerOptions {
  db: BusinessDb;
  sender: MessageSender;
  ollama?: OllamaClient;
  /** Staff/owner numbers — get the ops channel + escalations. */
  staff: string[];
  delSheetDir?: string;
  /** Injectable business-date clock (defaults to IST today); tests pin it. */
  today?: () => string;
}

const STAFF_HELP = `🌸 Ops commands

due [YYYY-MM-DD|tomorrow] — deliveries due (default today)
sheet [YYYY-MM-DD|tomorrow] — generate the delivery sheet file
master — export the full Master view as Excel (verification)
payrun [YYYY-MM-DD] — payment messages for that day's deliveries (preview)
pending — cycles with money to collect
renewals — finished cycles awaiting renewal
paid <id> [amount] — mark latest cycle paid (after verifying)
renew <id> — note renewal; next cycle set up manually for now
hold <id> [weeks] / resume <id> — pause/resume a subscription
restrict <id> <flower> — add a flower restriction
note <id> <text> — append a remark
find <name or phone> — look up a customer
customer <id> — customer profile`;

const LLM_CLASSIFY_PROMPT = `You classify flower-subscription customer messages.
Categories: SKIP_TODAY (hold one delivery), SKIP_WEEKS, HOLD_INDEFINITE, RESUME,
DAY_CHANGE, PAYMENT_CLAIM, RESTRICTION, ADDRESS_CHANGE, STATUS, CANCEL_SUBSCRIPTION,
RENEW, OTHER.
Reply ONLY with JSON: {"category": "...", "weeks": number|null, "day": "monday-sunday or null", "flower": "name or null", "mode": "payment mode or null"}`;

export class BusinessMessageHandler {
  private db: BusinessDb;
  private sender: MessageSender;
  private ollama?: OllamaClient;
  private staff: string[];
  private delSheetDir: string;
  private today: () => string;

  constructor(options: BusinessHandlerOptions) {
    this.db = options.db;
    this.sender = options.sender;
    this.ollama = options.ollama;
    this.staff = options.staff;
    this.delSheetDir = options.delSheetDir ?? './data';
    this.today = options.today ?? todayIST;
  }

  isStaff(phone: string): boolean {
    return this.staff.some(s => samePhone(s, phone));
  }

  async handleMessage(from: string, message: string): Promise<void> {
    try {
      if (this.isStaff(from)) {
        await this.sender.sendMessage(from, await this.handleStaffCommand(message));
        return;
      }
      await this.handleCustomerMessage(from, message);
    } catch (error) {
      logger.error({ error, from, message }, 'Business handler failed');
      await this.alertStaff(`⚠️ Handler error for ${from}: "${message.slice(0, 80)}" — check logs.`);
    }
  }

  // ---- Customers -------------------------------------------------------------

  private async handleCustomerMessage(from: string, message: string): Promise<void> {
    const today = this.today();
    const customer = findCustomerByPhone(this.db, from);

    if (!customer) {
      // Unknown number: likely a new-customer/bouquet lead — pure gold, never drop
      await this.alertStaff(`🆕 Unknown number ${from}: "${message.slice(0, 200)}"`);
      await this.sender.sendMessage(
        from,
        'Welcome to Bring My Flowers! 🌸 Our team will reply to you shortly.'
      );
      return;
    }

    let instruction = parseInstruction(message, today);
    if (!instruction && this.ollama) {
      instruction = await this.classifyWithLlm(message, today);
    }

    if (!instruction) {
      appendRemark(this.db, customer.id, `Msg: ${message.slice(0, 120)}`, today);
      await this.alertStaff(`❓ ${customer.name} (#${customer.id}): "${message.slice(0, 200)}"`);
      await this.sender.sendMessage(
        from,
        `Thanks ${customer.name}! We've noted your message and our team will get back to you shortly. 🌸`
      );
      return;
    }

    const result = applyInstruction(this.db, customer, instruction, today);
    await this.sender.sendMessage(from, result.reply);
    if (result.ownerAlert) await this.alertStaff(result.ownerAlert);
  }

  private async classifyWithLlm(message: string, today: string): Promise<Instruction | null> {
    try {
      const response = await this.ollama!.generate(
        `Message: "${message}"\n\nClassify and return JSON only:`,
        LLM_CLASSIFY_PROMPT,
        { json: true }
      );
      const parsed = JSON.parse(response.match(/\{[\s\S]*\}/)?.[0] ?? '{}') as {
        category?: string; weeks?: number; day?: string; flower?: string; mode?: string;
      };
      switch (parsed.category) {
        case 'SKIP_TODAY': return { type: 'SKIP_TODAY' };
        case 'SKIP_WEEKS': return { type: 'SKIP', weeks: parsed.weeks && parsed.weeks > 0 ? Math.min(parsed.weeks, 8) : 1 };
        case 'HOLD_INDEFINITE': return { type: 'HOLD_INDEFINITE' };
        case 'RESUME': return { type: 'RESUME' };
        case 'PAYMENT_CLAIM': return { type: 'PAYMENT_CLAIM', mode: parsed.mode || 'online' };
        case 'STATUS': return { type: 'STATUS' };
        case 'CANCEL_SUBSCRIPTION': return { type: 'CANCEL_SUBSCRIPTION' };
        case 'RENEW': return { type: 'RENEW' };
        case 'DAY_CHANGE': {
          const day = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].indexOf((parsed.day || '').toLowerCase());
          return day >= 0 ? { type: 'DAY_CHANGE', day } : null;
        }
        case 'RESTRICTION':
          return parsed.flower ? { type: 'RESTRICTION', flower: parsed.flower } : null;
        // ADDRESS_CHANGE via LLM is too risky to auto-apply — escalate instead
        default: return null;
      }
    } catch (error) {
      logger.warn({ error, message }, 'LLM classification failed');
      return null;
    }
  }

  // ---- Staff -------------------------------------------------------------------

  private async handleStaffCommand(message: string): Promise<string> {
    const today = this.today();
    const parts = message.trim().split(/\s+/);
    const command = parts[0]?.toLowerCase() ?? '';

    const dateArg = (raw?: string) => {
      if (!raw) return today;
      if (raw.toLowerCase() === 'tomorrow') return addDays(today, 1);
      return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : today;
    };

    switch (command) {
      case 'help':
        return STAFF_HELP;

      case 'due': {
        const date = dateArg(parts[1]);
        const rows = dueRows(this.db, date);
        if (rows.length === 0) return `No deliveries due ${date}.`;
        const byZone = new Map<string, number>();
        for (const row of rows) byZone.set(row.zone || '?', (byZone.get(row.zone || '?') ?? 0) + 1);
        const zoneLine = [...byZone.entries()].map(([zone, count]) => `${zone}: ${count}`).join(', ');
        const pendingCount = rows.filter(row => row.collect !== '').length;
        return `📋 ${rows.length} deliveries due ${date}\n${zoneLine}\n💰 ${pendingCount} with payment to collect\n\nUse "sheet ${date}" for the full delivery sheet.`;
      }

      case 'sheet': {
        const date = dateArg(parts[1]);
        const outPath = `${this.delSheetDir}/del-sheet-${date}.xlsx`;
        const result = writeDelSheetDetailed(this.db, date, outPath);
        const manualLine = result.manual.length > 0
          ? `\n✍️ ${result.manual.length} manual: ${result.manual.slice(0, 8).map(m => `#${m.id}`).join(', ')}${result.manual.length > 8 ? '…' : ''}`
          : '';
        return `📋 Delivery sheet for ${date}: ${result.rows} rows, ${result.autoAssigned} auto-assigned${manualLine}\n→ ${outPath} (see Procurement tab for TO BUY)`;
      }

      case 'master': {
        const outPath = `${this.delSheetDir}/master-view-${today}.xlsx`;
        const rows = writeMasterView(this.db, outPath);
        return `📖 Master view exported: ${rows} rows → ${outPath}\nOpen it in Excel — every bot action is already reflected there.`;
      }

      case 'payrun': {
        const date = dateArg(parts[1] ?? addDays(today, -1));
        const messages = buildPaymentMessages(this.db, date);
        if (messages.length === 0) return `No payment messages for ${date}.`;
        const preview = messages.slice(0, 15).map(m =>
          `${m.kind === 'PAYMENT_DUE' ? '🔴' : m.kind === 'CYCLE_COMPLETE' ? '🔁' : '🟢'} #${m.customerId} ${m.name}`
        ).join('\n');
        const due = messages.filter(m => m.kind !== 'RECEIVED').length;
        return `💬 ${messages.length} payment messages for ${date} (${due} chasing money/renewal)\n${preview}${messages.length > 15 ? `\n…and ${messages.length - 15} more` : ''}`;
      }

      case 'pending': {
        const rows = this.db.prepare(`
          SELECT c.id, c.name, cy.collect FROM cycles cy
          JOIN subscriptions s ON cy.subscription_id = s.id
          JOIN customers c ON s.customer_id = c.id
          WHERE cy.payment_status = 'PENDING' AND cy.collect > 0 AND s.status = 'ACTIVE'
          ORDER BY cy.collect DESC LIMIT 30
        `).all() as Array<{ id: string; name: string; collect: number }>;
        if (rows.length === 0) return '💰 Nothing pending. 🎉';
        const total = rows.reduce((sum, row) => sum + row.collect, 0);
        return `💰 Pending collections (top ${rows.length}) — ₹${total}\n` +
          rows.map(row => `#${row.id} ${row.name}: ₹${row.collect}`).join('\n');
      }

      case 'renewals': {
        const due = renewalsDue(this.db, today);
        if (due.length === 0) return '🔁 No renewals waiting.';
        return `🔁 ${due.length} renewals due\n` + due.slice(0, 25).map(renewal =>
          `#${renewal.customerId} ${renewal.name} — ${renewal.packageName} ₹${renewal.packAmount}, last delivery ${renewal.lastDelivery} (${renewal.daysSince}d ago)`
        ).join('\n');
      }

      case 'paid': {
        const customerId = parts[1];
        if (!customerId) return 'Usage: paid <customer-id> [amount]';
        const cycle = this.db.prepare(`
          SELECT cy.id, cy.collect FROM cycles cy
          JOIN subscriptions s ON cy.subscription_id = s.id
          WHERE s.customer_id = ? ORDER BY cy.renewal_date DESC, cy.id DESC LIMIT 1
        `).get(customerId) as { id: number; collect: number } | undefined;
        if (!cycle) return `No cycle found for #${customerId}.`;
        const amount = parts[2] ? Number(parts[2]) : cycle.collect;
        this.db.prepare(`
          UPDATE cycles SET payment_status = 'COMPLETED', payment_date = ?, amount_received = ?, collect = 0
          WHERE id = ?
        `).run(today, Number.isFinite(amount) ? amount : null, cycle.id);
        appendRemark(this.db, customerId, `Payment received${amount ? ` ₹${amount}` : ''}`, today);
        return `✅ #${customerId}: latest cycle marked paid${amount ? ` (₹${amount})` : ''}.`;
      }

      case 'hold': {
        const customerId = parts[1];
        if (!customerId) return 'Usage: hold <customer-id> [weeks]';
        const customer = this.customerById(customerId);
        if (!customer) return `Customer #${customerId} not found.`;
        const weeks = parts[2] ? parseInt(parts[2], 10) : null;
        const result = applyInstruction(this.db, customer, weeks && weeks > 0 ? { type: 'SKIP', weeks } : { type: 'HOLD_INDEFINITE' }, today);
        return result.reply.replace(/ 🌸$/, '') + ` (#${customerId})`;
      }

      case 'resume': {
        const customerId = parts[1];
        if (!customerId) return 'Usage: resume <customer-id>';
        const customer = this.customerById(customerId);
        if (!customer) return `Customer #${customerId} not found.`;
        const result = applyInstruction(this.db, customer, { type: 'RESUME' }, today);
        return result.reply.replace(/ 🌸$/, '') + ` (#${customerId})`;
      }

      case 'restrict': {
        const customerId = parts[1];
        const flower = parts.slice(2).join(' ');
        if (!customerId || !flower) return 'Usage: restrict <customer-id> <flower>';
        const customer = this.customerById(customerId);
        if (!customer) return `Customer #${customerId} not found.`;
        applyInstruction(this.db, customer, { type: 'RESTRICTION', flower }, today);
        return `🚫 #${customerId}: no ${flower} from now on.`;
      }

      case 'renew': {
        const customerId = parts[1];
        if (!customerId) return 'Usage: renew <customer-id>';
        const renewal = createNextCycle(this.db, customerId, today);
        return renewal.ok ? `🔁 #${customerId}: ${renewal.message}` : `⚠️ ${renewal.message}`;
      }

      case 'note': {
        const customerId = parts[1];
        const text = parts.slice(2).join(' ');
        if (!customerId || !text) return 'Usage: note <customer-id> <text>';
        appendRemark(this.db, customerId, text, today);
        return `📝 Noted on #${customerId}.`;
      }

      case 'find': {
        const query = parts.slice(1).join(' ');
        if (!query) return 'Usage: find <name or phone>';
        const digits = query.replace(/\D/g, '');
        const rows = (digits.length >= 7
          ? this.db.prepare(`SELECT id, name, zone, phones FROM customers WHERE phones LIKE ? LIMIT 8`).all(`%${digits.slice(-10)}%`)
          : this.db.prepare(`SELECT id, name, zone, phones FROM customers WHERE name LIKE ? LIMIT 8`).all(`%${query}%`)
        ) as Array<{ id: string; name: string; zone: string; phones: string }>;
        if (rows.length === 0) return `No customer matching "${query}".`;
        return rows.map(row => `#${row.id} ${row.name} — ${row.zone} — ${row.phones.split('//')[0]}`).join('\n');
      }

      case 'customer': {
        const customerId = parts[1];
        const customer = this.customerById(customerId ?? '');
        if (!customer) return `Customer #${customerId} not found.`;
        const subscription = this.db.prepare(`
          SELECT package_name, pack_amount, frequency, day, time_slot, status
          FROM subscriptions WHERE customer_id = ? ORDER BY id DESC LIMIT 1
        `).get(customer.id) as { package_name: string; pack_amount: number; frequency: string; day: string; time_slot: string; status: string } | undefined;
        const restrictions = (this.db.prepare(`SELECT flower FROM restrictions WHERE customer_id = ?`).all(customer.id) as Array<{ flower: string }>)
          .map(row => row.flower).join(', ');
        const nextDelivery = this.db.prepare(`
          SELECT COALESCE(NULLIF(d.changed_date,''), d.planned_date) AS date FROM deliveries d
          JOIN cycles cy ON d.cycle_id = cy.id JOIN subscriptions s ON cy.subscription_id = s.id
          WHERE s.customer_id = ? AND d.status = 'PLANNED' AND date >= ? ORDER BY date LIMIT 1
        `).get(customer.id, today) as { date: string } | undefined;
        return `#${customer.id} ${customer.name}\n📍 ${customer.address} (${customer.zone})\n📞 ${customer.phones.replace(/\/\//g, ', ')}` +
          (subscription ? `\n📦 ${subscription.package_name} ₹${subscription.pack_amount} · ${subscription.frequency} ${subscription.day} ${subscription.time_slot} · ${subscription.status}` : '\n📦 no subscription') +
          (restrictions ? `\n🚫 ${restrictions}` : '') +
          (nextDelivery ? `\n🚚 next: ${nextDelivery.date}` : '');
      }

      default:
        return `Unrecognized command "${command}".\n\n${STAFF_HELP}`;
    }
  }

  private customerById(id: string): CustomerRecord | null {
    return (this.db.prepare(`SELECT id, name, phones, address, zone FROM customers WHERE id = ?`).get(id) as CustomerRecord | undefined) ?? null;
  }

  private async alertStaff(message: string): Promise<void> {
    await this.sender.sendMessageToMultiple(this.staff, message);
  }
}
