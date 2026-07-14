import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, BusinessDb } from '../src/business/db';
import { qaToolDefinitions, executeQaTool } from '../src/business/qaTools';
import { answerQuestion, refineQuestion, answerWithLocalTools } from '../src/business/qaAgent';
import { ChatMessage, ChatResult, ChatTool, LLMProvider } from '../src/llm/provider';

const TODAY = '2026-07-14';

let db: BusinessDb;

function seed() {
  db.prepare(`INSERT INTO customers (id, name, phones, address, zone)
              VALUES ('401', 'Nameesha Verma', '9811111111', 'D-4/102, Parsvanath Exotica', 'DLF Phase 5')`).run();
  db.prepare(`INSERT INTO subscriptions (id, customer_id, package_name, pack_amount, frequency, day, status)
              VALUES (1, '401', 'Bloom', 1600, 'BIWEEKLY', 'Thursday', 'ACTIVE')`).run();
  db.prepare(`INSERT INTO cycles (id, subscription_id, deliveries_planned, pack_amount, per_delivery_revenue, payment_status, collect)
              VALUES (1, 1, 4, 1600, 400, 'PENDING', 3200)`).run();
  db.prepare(`INSERT INTO deliveries (cycle_id, seq, planned_date, status) VALUES (1, 1, '2026-07-16', 'PLANNED')`).run();

  db.prepare(`INSERT INTO customers (id, name, phones, address, zone)
              VALUES ('402', 'Small Debtor', '9822222222', 'B-1', 'Sohna Road 1')`).run();
  db.prepare(`INSERT INTO subscriptions (id, customer_id, package_name, pack_amount, frequency, day, status)
              VALUES (2, '402', 'Joy', 1950, 'WEEKLY', 'Friday', 'ACTIVE')`).run();
  db.prepare(`INSERT INTO cycles (id, subscription_id, deliveries_planned, pack_amount, per_delivery_revenue, payment_status, collect)
              VALUES (2, 2, 4, 1950, 487.5, 'PENDING', 500)`).run();
}

beforeEach(() => {
  db = openDb(':memory:');
  seed();
});

describe('qaTools', () => {
  it('get_pending_collections ranks debtors with the grand total', () => {
    const result = JSON.parse(executeQaTool({ db, today: TODAY }, 'get_pending_collections', {}));
    expect(result.totalPending).toBe(3700);
    expect(result.topDebtors[0]).toMatchObject({ id: '401', name: 'Nameesha Verma', owed: 3200 });
    expect(result.topDebtors[1]).toMatchObject({ id: '402', owed: 500 });
  });

  it('find_customer returns balance and next delivery', () => {
    const result = JSON.parse(executeQaTool({ db, today: TODAY }, 'find_customer', { name: 'Nameesha' }));
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: '401', amountOwed: 3200, nextDelivery: '2026-07-16' });
  });

  it('unknown tools and tool errors return structured messages instead of throwing', () => {
    expect(JSON.parse(executeQaTool({ db, today: TODAY }, 'drop_tables', {}))).toHaveProperty('error');
    expect(JSON.parse(executeQaTool({ db, today: TODAY }, 'find_customer', {}))).toHaveProperty('error');
  });

  it('exposes no mutation tools', () => {
    for (const tool of qaToolDefinitions()) {
      expect(tool.name).toMatch(/^(get_|find_)/);
    }
  });
});

/** Scripted provider: replays canned turns, records everything it was asked. */
class FakeProvider implements LLMProvider {
  readonly name = 'fake';
  calls: Array<{ system: string; messages: ChatMessage[]; tools: ChatTool[] }> = [];

  constructor(private turns: ChatResult[]) {}

  async chat(system: string, messages: ChatMessage[], tools: ChatTool[]): Promise<ChatResult> {
    this.calls.push({ system, messages, tools });
    const turn = this.turns.shift();
    if (!turn) throw new Error('FakeProvider ran out of scripted turns');
    return turn;
  }
}

describe('qaAgent', () => {
  it('refines the question, runs tools, and returns the final answer', async () => {
    const provider = new FakeProvider([
      { text: 'Which single customer has the largest outstanding pending amount, and how much is it?', toolCalls: [] },
      { text: '', toolCalls: [{ id: 't1', name: 'get_pending_collections', input: { limit: 1 } }] },
      { text: 'Nameesha Verma owes the most: ₹3,200 pending.', toolCalls: [] }
    ]);

    const answer = await answerQuestion({ provider, db, today: TODAY }, 'who owes us the most?');

    expect(answer).toContain('Nameesha Verma');
    // Refinement call carries no tools; answer calls carry the read-only set
    expect(provider.calls[0].tools).toHaveLength(0);
    expect(provider.calls[1].tools.length).toBeGreaterThan(0);
    // The tool result actually reached the model on the final turn
    const toolMessage = provider.calls[2].messages.find(message => message.role === 'tool');
    expect(toolMessage && JSON.parse((toolMessage as { content: string }).content).topDebtors[0].name)
      .toBe('Nameesha Verma');
  });

  it('falls back to the original question when refinement fails', async () => {
    const failing: LLMProvider = {
      name: 'failing',
      chat: async () => { throw new Error('api down'); }
    };
    expect(await refineQuestion(failing, 'who owes us?', TODAY)).toBe('who owes us?');
  });

  it('stops the loop and forces a text answer after the round limit', async () => {
    const loopingTurn: ChatResult = {
      text: '',
      toolCalls: [{ id: 'x', name: 'get_business_overview', input: {} }]
    };
    const provider = new FakeProvider([
      { text: 'refined', toolCalls: [] },
      loopingTurn, loopingTurn, loopingTurn, loopingTurn, loopingTurn, loopingTurn,
      { text: 'Final summary.', toolCalls: [] }
    ]);

    const answer = await answerQuestion({ provider, db, today: TODAY }, 'summarize everything');

    expect(answer).toBe('Final summary.');
    // The forced final call must offer no tools
    expect(provider.calls[provider.calls.length - 1].tools).toHaveLength(0);
  });
});

describe('answerWithLocalTools', () => {
  it('names the top debtor and their balance', () => {
    const answer = answerWithLocalTools({ db, today: TODAY }, 'who owes us the most money?');
    expect(answer).toContain('Nameesha Verma');
    expect(answer).toContain('3,200');
  });

  it('returns a specific customer balance', () => {
    const answer = answerWithLocalTools({ db, today: TODAY }, 'how much does Nameesha Verma owe us?');
    expect(answer).toContain('Nameesha Verma');
    expect(answer).toContain('3,200');
  });

  it('returns delivery totals for a date question', () => {
    db.prepare(`INSERT INTO customers (id, name, phones, address, zone)
                VALUES ('501', 'Today Customer', '', 'A-1', 'Zone B')`).run();
    db.prepare(`INSERT INTO subscriptions (id, customer_id, package_name, pack_amount, frequency, day, status)
                VALUES (3, '501', 'Joy', 1950, 'WEEKLY', 'Monday', 'ACTIVE')`).run();
    db.prepare(`INSERT INTO cycles (id, subscription_id, deliveries_planned, pack_amount, per_delivery_revenue, payment_status, collect)
                VALUES (3, 3, 4, 1950, 487.5, 'PENDING', 1950)`).run();
    db.prepare(`INSERT INTO deliveries (cycle_id, seq, planned_date, status) VALUES (3, 1, ?, 'PLANNED')`).run(TODAY);

    const answer = answerWithLocalTools({ db, today: TODAY }, 'total order amount today');
    expect(answer).toMatch(/1 deliveries/);
    expect(answer).toMatch(/1,950/);
  });
});
