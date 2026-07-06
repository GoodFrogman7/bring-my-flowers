import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, BusinessDb } from '../src/business/db';
import { applyInstruction, findCustomerByPhone } from '../src/business/actions';
import { buildPaymentMessages, renewalsDue } from '../src/business/paymentRun';
import { BusinessMessageHandler } from '../src/business/businessHandler';
import { FakeSender } from './helpers';

const TODAY = '2026-07-06'; // Monday

let db: BusinessDb;

/** Seed one weekly subscriber (#100, Monday) with a 4-delivery cycle from 2026-07-06. */
function seed(options: { paymentStatus?: string; deliveredSeq?: number[] } = {}) {
  db.prepare(`INSERT INTO customers (id, name, phones, address, zone) VALUES ('100', 'Test Customer', '9876543210', 'H-1, Test Society', 'Test Zone')`).run();
  db.prepare(`INSERT INTO subscriptions (id, customer_id, package_name, pack_amount, frequency, day, time_slot, status)
              VALUES (1, '100', 'Bliss', 1450, 'WEEKLY', 'Monday', '9 AM - 12 PM', 'ACTIVE')`).run();
  db.prepare(`INSERT INTO cycles (id, subscription_id, renewal_date, deliveries_planned, pack_amount, per_delivery_revenue, payment_status, collect)
              VALUES (1, 1, '2026-07-01', 4, 1450, 362.5, ?, ?)`)
    .run(options.paymentStatus ?? 'PENDING', options.paymentStatus === 'COMPLETED' ? 0 : 1450);
  const dates = ['2026-07-06', '2026-07-13', '2026-07-20', '2026-07-27'];
  for (let i = 0; i < 4; i++) {
    const delivered = options.deliveredSeq?.includes(i + 1);
    db.prepare(`INSERT INTO deliveries (cycle_id, seq, planned_date, status) VALUES (1, ?, ?, ?)`)
      .run(i + 1, dates[i], delivered ? 'DELIVERED' : 'PLANNED');
  }
}

function customer() {
  return { id: '100', name: 'Test Customer', phones: '9876543210', address: 'H-1, Test Society', zone: 'Test Zone' };
}

function effectiveDates(): string[] {
  return (db.prepare(`SELECT COALESCE(NULLIF(changed_date,''), planned_date) AS d FROM deliveries ORDER BY seq`).all() as Array<{ d: string }>).map(r => r.d);
}

beforeEach(() => {
  db = openDb(':memory:');
  seed();
});

describe('findCustomerByPhone', () => {
  it('matches with country code, plus, and whatsapp formats', () => {
    expect(findCustomerByPhone(db, '+919876543210')?.id).toBe('100');
    expect(findCustomerByPhone(db, '919876543210')?.id).toBe('100');
    expect(findCustomerByPhone(db, '9876543210')?.id).toBe('100');
    expect(findCustomerByPhone(db, '+911111111111')).toBeNull();
  });
});

describe('applyInstruction', () => {
  it('SKIP_TODAY moves only the next delivery by a week', () => {
    const result = applyInstruction(db, customer(), { type: 'SKIP_TODAY' }, TODAY);
    expect(effectiveDates()).toEqual(['2026-07-13', '2026-07-13', '2026-07-20', '2026-07-27']);
    expect(result.reply).toContain('2026-07-13');
    const remarks = (db.prepare(`SELECT remarks FROM customers WHERE id='100'`).get() as { remarks: string }).remarks;
    expect(remarks).toContain('(06/07)'); // owner's dd/mm stamp
  });

  it('SKIP 2 weeks shifts every remaining delivery', () => {
    applyInstruction(db, customer(), { type: 'SKIP', weeks: 2 }, TODAY);
    expect(effectiveDates()).toEqual(['2026-07-20', '2026-07-27', '2026-08-03', '2026-08-10']);
  });

  it('HOLD_INDEFINITE puts the subscription on HOLD; RESUME reschedules from the fixed day', () => {
    applyInstruction(db, customer(), { type: 'HOLD_INDEFINITE' }, TODAY);
    expect((db.prepare(`SELECT status FROM subscriptions WHERE id=1`).get() as { status: string }).status).toBe('HOLD');

    const result = applyInstruction(db, customer(), { type: 'RESUME' }, '2026-07-21'); // a Tuesday
    expect((db.prepare(`SELECT status FROM subscriptions WHERE id=1`).get() as { status: string }).status).toBe('ACTIVE');
    // Past-due deliveries rescheduled onto Mondays after resume date
    const dates = effectiveDates();
    expect(dates[0]).toBe('2026-07-27');
    expect(dates[1]).toBe('2026-08-03');
    expect(result.reply).toContain('2026-07-27');
  });

  it('DAY_CHANGE moves remaining deliveries to the new weekday', () => {
    applyInstruction(db, customer(), { type: 'DAY_CHANGE', day: 4 }, TODAY); // Thursday
    expect(effectiveDates()).toEqual(['2026-07-09', '2026-07-16', '2026-07-23', '2026-07-30']);
    expect((db.prepare(`SELECT day FROM subscriptions WHERE id=1`).get() as { day: string }).day).toBe('Thursday');
  });

  it('RESCHEDULE_NEXT moves just the next delivery to the target date', () => {
    applyInstruction(db, customer(), { type: 'RESCHEDULE_NEXT', date: '2026-07-08' }, TODAY);
    expect(effectiveDates()).toEqual(['2026-07-08', '2026-07-13', '2026-07-20', '2026-07-27']);
  });

  it('PAYMENT_CLAIM records a remark and alerts staff without marking paid', () => {
    const result = applyInstruction(db, customer(), { type: 'PAYMENT_CLAIM', mode: 'paytm' }, TODAY);
    expect(result.ownerAlert).toContain('VERIFY');
    expect((db.prepare(`SELECT payment_status FROM cycles WHERE id=1`).get() as { payment_status: string }).payment_status).toBe('PENDING');
  });

  it('RESTRICTION adds to the restrictions table', () => {
    applyInstruction(db, customer(), { type: 'RESTRICTION', flower: 'gerbera' }, TODAY);
    expect(db.prepare(`SELECT flower FROM restrictions WHERE customer_id='100'`).all()).toEqual([{ flower: 'gerbera' }]);
  });

  it('CANCEL_SUBSCRIPTION pauses and escalates, never deletes', () => {
    const result = applyInstruction(db, customer(), { type: 'CANCEL_SUBSCRIPTION' }, TODAY);
    expect((db.prepare(`SELECT status FROM subscriptions WHERE id=1`).get() as { status: string }).status).toBe('HOLD');
    expect(result.ownerAlert).toContain('CANCELLATION REQUEST');
  });

  it('STATUS reports next delivery, seq, and pending amount', () => {
    const result = applyInstruction(db, customer(), { type: 'STATUS' }, TODAY);
    expect(result.reply).toContain('1st of 4');
    expect(result.reply).toContain('2026-07-06');
    expect(result.reply).toContain('₹1450');
  });
});

describe('buildPaymentMessages', () => {
  it('uses the owner’s two templates and appends renewal on the last delivery', () => {
    // Pending payment, 1st delivery
    let messages = buildPaymentMessages(db, '2026-07-06');
    expect(messages).toHaveLength(1);
    expect(messages[0].kind).toBe('PAYMENT_DUE');
    expect(messages[0].message).toContain('1st of your 4 deliveries');
    expect(messages[0].message).toContain('not received the payment');
    expect(messages[0].message).toContain('₹1450');

    // Paid cycle, final delivery → received + renewal ask
    db.prepare(`UPDATE cycles SET payment_status='COMPLETED', collect=0`).run();
    messages = buildPaymentMessages(db, '2026-07-27');
    expect(messages[0].kind).toBe('CYCLE_COMPLETE');
    expect(messages[0].message).toContain('4th of your 4 deliveries');
    expect(messages[0].message).toContain('received the payment');
    expect(messages[0].message).toContain('renew');
  });

  it('never chases complimentary or in-process cycles', () => {
    db.prepare(`UPDATE cycles SET payment_status='COMPLIMENTARY'`).run();
    expect(buildPaymentMessages(db, '2026-07-06')).toHaveLength(0);
  });
});

describe('renewalsDue', () => {
  it('lists active subscriptions whose cycle is fully delivered', () => {
    db.prepare(`UPDATE deliveries SET status='DELIVERED'`).run();
    const due = renewalsDue(db, '2026-07-30');
    expect(due).toHaveLength(1);
    expect(due[0].customerId).toBe('100');
    expect(due[0].lastDelivery).toBe('2026-07-27');
    expect(due[0].daysSince).toBe(3);
  });

  it('is empty while deliveries remain', () => {
    expect(renewalsDue(db, '2026-07-10')).toHaveLength(0);
  });
});

describe('BusinessMessageHandler routing', () => {
  const clock = { today: () => TODAY };

  it('routes a known customer instruction end to end', async () => {
    const sender = new FakeSender();
    const handler = new BusinessMessageHandler({ db, sender, staff: ['+919999999999'], ...clock });

    await handler.handleMessage('+919876543210', 'skip this week');

    // Customer reply + staff alert
    expect(sender.sent[0].to).toBe('+919876543210');
    expect(sender.sent[0].message).toContain('skipped 1 week');
    expect(sender.sent[1].to).toBe('+919999999999');
    expect(effectiveDates()[0]).toBe('2026-07-13');
  });

  it('escalates unknown numbers to staff with a friendly ack', async () => {
    const sender = new FakeSender();
    const handler = new BusinessMessageHandler({ db, sender, staff: ['+919999999999'], ...clock });

    await handler.handleMessage('+915555555555', 'I want a bouquet for tomorrow');

    const staffMsg = sender.sent.find(m => m.to === '+919999999999');
    expect(staffMsg?.message).toContain('Unknown number');
    expect(staffMsg?.message).toContain('bouquet');
  });

  it('escalates unparseable messages from known customers, never drops them', async () => {
    const sender = new FakeSender();
    const handler = new BusinessMessageHandler({ db, sender, staff: ['+919999999999'], ...clock });

    await handler.handleMessage('9876543210', 'bhaiya kal wale flowers thode kharab the');

    const staffMsg = sender.sent.find(m => m.to === '+919999999999');
    expect(staffMsg?.message).toContain('#100');
    const remarks = (db.prepare(`SELECT remarks FROM customers WHERE id='100'`).get() as { remarks: string }).remarks;
    expect(remarks).toContain('Msg:');
  });

  it('staff numbers get the ops channel', async () => {
    const sender = new FakeSender();
    const handler = new BusinessMessageHandler({ db, sender, staff: ['+919999999999'], ...clock });

    await handler.handleMessage('+919999999999', 'due 2026-07-06');
    expect(sender.lastMessage()).toContain('1 deliveries due 2026-07-06');

    await handler.handleMessage('+919999999999', 'paid 100 1450');
    expect(sender.lastMessage()).toContain('marked paid');
    expect((db.prepare(`SELECT payment_status, collect FROM cycles WHERE id=1`).get() as { payment_status: string; collect: number }))
      .toEqual({ payment_status: 'COMPLETED', collect: 0 });

    await handler.handleMessage('+919999999999', 'customer 100');
    expect(sender.lastMessage()).toContain('Bliss ₹1450');

    await handler.handleMessage('+919999999999', 'find 9876543210');
    expect(sender.lastMessage()).toContain('#100');

    await handler.handleMessage('+919999999999', 'find Test');
    expect(sender.lastMessage()).toContain('#100');
  });
});
