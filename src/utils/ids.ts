export function generateOrderId(): string {
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `ORD-${Date.now().toString(36).toUpperCase()}-${rand}`;
}

export function generateRecurringId(): string {
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `REC-${Date.now().toString(36).toUpperCase()}-${rand}`;
}

/**
 * Phone equality across transports: Baileys reports "919876543210", Twilio
 * "+919876543210", config may hold either. Compare digits only.
 */
export function samePhone(a: string, b: string): boolean {
  const digits = (s: string) => s.replace(/\D/g, '');
  return digits(a) !== '' && digits(a) === digits(b);
}
