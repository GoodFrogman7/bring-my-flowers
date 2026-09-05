/**
 * Order line items live in a single spreadsheet cell (Order.items /
 * RecurringOrder.items), so they are encoded as a human-readable string:
 *
 *   "5 Roses, 3 Lilies"
 *
 * Owners read these cells directly in Excel/Google Sheets, so the format is
 * prose-like on purpose. Rows written before multi-item support hold a bare
 * flower name ("Roses") with the count in the separate quantity column —
 * parseItems falls back to that quantity for such segments.
 */

export interface OrderItemSpec {
  name: string;
  quantity: number;
}

export function serializeItems(items: OrderItemSpec[]): string {
  return items.map(item => `${item.quantity} ${item.name}`).join(', ');
}

/**
 * Parse an items cell back into line items. Segments without a leading count
 * (legacy rows) get `fallbackQuantity` — the order's quantity column.
 */
export function parseItems(itemsStr: string, fallbackQuantity: number = 0): OrderItemSpec[] {
  return itemsStr
    .split(',')
    .map(segment => segment.trim())
    .filter(segment => segment.length > 0)
    .map(segment => {
      const match = segment.match(/^(\d+)\s+(.+)$/);
      if (match) {
        return { name: match[2].trim(), quantity: parseInt(match[1], 10) };
      }
      return { name: segment, quantity: fallbackQuantity };
    });
}

/** Total units across all line items. */
export function totalQuantity(items: OrderItemSpec[]): number {
  return items.reduce((sum, item) => sum + item.quantity, 0);
}

/**
 * Display form for any items cell, old or new: "5 Roses, 3 Lilies".
 * Legacy cells ("Roses" + quantity column 10) render as "10 Roses".
 */
export function displayItems(itemsStr: string, fallbackQuantity: number): string {
  return serializeItems(parseItems(itemsStr, fallbackQuantity));
}
