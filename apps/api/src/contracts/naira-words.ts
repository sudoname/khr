/**
 * Converts a decimal amount string (as stored for Decimal(18,2) columns, e.g.
 * "5200000.50") into Nigerian contract wording:
 *   "Five Million, Two Hundred Thousand Naira and Fifty Kobo Only"
 * Pure function — no locale or floating-point involvement (BigInt for the
 * whole part), so it is safe for the full Decimal(18,2) range.
 */

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const SCALES = ['', ' Thousand', ' Million', ' Billion', ' Trillion', ' Quadrillion'];

/** 0–999 */
function hundreds(n: number): string {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} Hundred`);
    n %= 100;
    if (n > 0) parts.push('and');
  }
  if (n >= 20) {
    const tail = n % 10;
    parts.push(tail ? `${TENS[Math.floor(n / 10)]}-${ONES[tail]}` : TENS[Math.floor(n / 10)]);
  } else if (n > 0) {
    parts.push(ONES[n]);
  }
  return parts.join(' ');
}

function wholeWords(n: bigint): string {
  if (n === 0n) return 'Zero';
  // Split into base-1000 groups, least significant first.
  const groups: number[] = [];
  while (n > 0n) {
    groups.push(Number(n % 1000n));
    n /= 1000n;
  }
  const parts: string[] = [];
  for (let i = groups.length - 1; i >= 0; i--) {
    if (groups[i] === 0) continue;
    parts.push(`${hundreds(groups[i])}${SCALES[i]}`);
  }
  return parts.join(', ');
}

export function nairaWords(amount: string): string {
  const m = /^(\d{1,16})(?:\.(\d{1,2}))?$/.exec(amount.trim());
  if (!m) throw new Error(`nairaWords: expected a decimal amount, got "${amount}"`);
  const whole = BigInt(m[1]);
  const kobo = Number((m[2] ?? '').padEnd(2, '0') || '0');

  if (whole === 0n && kobo === 0) return 'Zero Naira Only';

  const parts: string[] = [];
  if (whole > 0n) parts.push(`${wholeWords(whole)} Naira`);
  if (kobo > 0) parts.push(`${hundreds(kobo)} Kobo`);
  return `${parts.join(' and ')} Only`;
}
