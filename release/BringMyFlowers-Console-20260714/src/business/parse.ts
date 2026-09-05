/**
 * Tolerant parsers for the Master workbook's real-world data: Excel serial
 * dates, '//'-separated phone lists with unicode junk, status typos, and the
 * pack/revenue arithmetic that encodes delivery frequency.
 */

/** Excel serial (days since 1899-12-30) → YYYY-MM-DD. Returns '' if invalid. */
export function serialToDate(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'string') {
    // Already a date string?
    const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[0];
    const n = Number(value.trim());
    if (!Number.isFinite(n)) return '';
    value = n;
  }
  const serial = value as number;
  // Plausible business dates: 2015..2035 (serial 42005..49674)
  if (!Number.isFinite(serial) || serial < 40000 || serial > 55000) return '';
  const ms = Math.round((serial - 25569) * 86400 * 1000); // 25569 = 1970-01-01
  return new Date(ms).toISOString().split('T')[0];
}

/** "9802300072 // 9996860…", " 81304 32211", RTL marks → "9802300072//9996860…" */
export function normalizePhones(raw: unknown): string {
  const text = String(raw ?? '');
  const parts = text
    .split(/\/\/|,|;/)
    .map(part => part.replace(/\D/g, ''))
    .filter(digits => digits.length >= 7);
  return [...new Set(parts)].join('//');
}

export type RowKind = 'SUBSCRIPTION' | 'ONE_TIME' | 'SKIP';
export type SubStatus = 'ACTIVE' | 'HOLD' | 'CLOSED';

/**
 * Classify a Master "Active" column value. 'Active 1' marks the current cycle
 * row; 'Renewed' rows are past cycles of (usually) still-live customers.
 */
export function classifyActiveValue(raw: unknown): { kind: RowKind; status: SubStatus; isCurrent: boolean } {
  const value = String(raw ?? '').trim().toLowerCase();
  switch (value) {
    case 'active 1':
    case 'active':
      return { kind: 'SUBSCRIPTION', status: 'ACTIVE', isCurrent: true };
    case 'renewed':
      return { kind: 'SUBSCRIPTION', status: 'ACTIVE', isCurrent: false };
    case 'hold':
    case 'hole': // real typo in the data
      return { kind: 'SUBSCRIPTION', status: 'HOLD', isCurrent: true };
    case 'closed':
      return { kind: 'SUBSCRIPTION', status: 'CLOSED', isCurrent: false };
    case 'corporate':
    case 'special project':
      return { kind: 'SUBSCRIPTION', status: 'ACTIVE', isCurrent: true };
    case 'bouquet':
      return { kind: 'ONE_TIME', status: 'CLOSED', isCurrent: false };
    case 'sample':
    case '':
      return { kind: 'SKIP', status: 'CLOSED', isCurrent: false };
    default:
      return { kind: 'SKIP', status: 'CLOSED', isCurrent: false };
  }
}

export type PaymentStatus = 'COMPLETED' | 'PENDING' | 'IN_PROCESS' | 'COMPLIMENTARY' | 'CANCELLED';

export function mapPaymentStatus(raw: unknown): PaymentStatus {
  const value = String(raw ?? '').trim().toLowerCase();
  if (value.startsWith('complet')) return 'COMPLETED';
  if (value.startsWith('complim')) return 'COMPLIMENTARY';
  if (value.startsWith('in pro') || value.startsWith('inpro')) return 'IN_PROCESS';
  if (value.startsWith('cancel')) return 'CANCELLED';
  return 'PENDING';
}

/**
 * Frequency from the pack/revenue ratio the owner uses for his P&L:
 * revenue = pack/4 → weekly (4-delivery cycle), pack/8 → biweekly (8).
 * Bouquets have revenue == pack. Defaults to weekly when unreadable.
 */
export function frequencyFromRevenue(pack: unknown, revenue: unknown): { frequency: 'WEEKLY' | 'BIWEEKLY'; deliveriesPerCycle: number } {
  const p = Number(pack);
  const r = Number(revenue);
  if (Number.isFinite(p) && Number.isFinite(r) && r > 0) {
    const ratio = Math.round(p / r);
    if (ratio >= 6) return { frequency: 'BIWEEKLY', deliveriesPerCycle: 8 };
  }
  return { frequency: 'WEEKLY', deliveriesPerCycle: 4 };
}

/**
 * "GULDAWARI n BOP n GERBERA", "Sunflower (30/04)" → ['GULDAWARI','BOP','GERBERA'] /
 * ['Sunflower'] — date annotations record when the restriction was added.
 */
export function parseRestrictions(raw: unknown): string[] {
  return String(raw ?? '')
    .split(/\s+n\s+|\/\/|,|&/i)
    .map(f => f.replace(/\([^)]*\)/g, '').trim())
    .filter(f => f.length > 1);
}

export function isOneTimeId(id: string): boolean {
  return /^B/i.test(id.trim());
}

/** Numeric IDs stay as-is; keeps G-/CP- prefixes; '' for junk. */
export function normalizeCustomerId(raw: unknown): string {
  const id = String(raw ?? '').trim();
  if (!id) return '';
  if (/^\d+$/.test(id)) return id;
  if (/^(G|CP|SP|B)-?\w+/i.test(id)) return id.toUpperCase().replace(/\s+/g, '');
  return '';
}

/**
 * The owner's status string as it appears on his delivery sheet, e.g.
 * "3 del of this cycle - 1-cycles pmnt Pending - Collect 1450"
 */
export function deliveryStatusString(
  seq: number,
  pendingCycles: number,
  paymentStatus: PaymentStatus,
  collect: number
): string {
  const statusWord = paymentStatus === 'COMPLETED' ? 'Completed'
    : paymentStatus === 'PENDING' ? 'Pending'
    : paymentStatus === 'IN_PROCESS' ? 'In Process'
    : paymentStatus === 'COMPLIMENTARY' ? 'Complimentary'
    : 'Cancelled';
  return `${seq}  del of this cycle   -  ${pendingCycles}-cycles pmnt   ${statusWord} - Collect ${collect}`;
}
