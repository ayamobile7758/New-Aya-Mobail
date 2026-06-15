/**
 * Money utilities.
 * All monetary values are represented as integer "fils" (smallest currency unit).
 * Do NOT use floats/decimals for monetary calculations.
 */

// 1. Add two amounts
export function addMoney(a: number, b: number): number {
  return Math.round(a) + Math.round(b);
}

// 2. Subtract two amounts
export function subMoney(a: number, b: number): number {
  return Math.round(a) - Math.round(b);
}

// 3. Multiply amount by quantity (qty must be integer)
export function mulMoney(amount: number, qty: number): number {
  return Math.round(amount) * Math.round(qty);
}

// 4. Apply percentage (rounded to nearest integer)
// percent is given as standard percentage (e.g., 15 for 15%)
export function applyPercent(amount: number, percent: number): number {
  return Math.round((amount * percent) / 100);
}

// 5. Format money for user display
// Default currency: د.أ (Jordanian Dinar)
export function formatMoney(fils: number, currency = 'د.أ'): string {
  const value = fils / 100;
  // Use "en-US" to keep western numbers (as requested: 1234 not ١٢٣٤)
  const formatted = value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currency ? `${formatted} ${currency}` : formatted;
}

// 6. Parse user input string to fils
export function parseMoney(input: string): number {
  // LO-D: normalize Arabic-Indic digits (٠-٩) to Western digits before parsing
  const normalized = input.replace(/[٠-٩]/g, d =>
    String.fromCharCode(d.charCodeAt(0) - 1632 + 48)
  );
  // Remove anything that is not a digit or a dot or minus sign
  const cleaned = normalized.replace(/[^0-9.-]+/g, '');
  if (!cleaned) return 0;
  
  const parsed = parseFloat(cleaned);
  if (isNaN(parsed)) return 0;
  
  return Math.max(0, Math.round(parsed * 100));
}
