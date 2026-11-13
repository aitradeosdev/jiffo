import { formatNaira } from '@jiffo/shared';

/** 150000 → "₦1,500". */
export const naira = (kobo: number) => formatNaira(kobo);

/** What someone typed in naira ("1,500", "1500.5") → whole kobo, or null if it isn't a number. */
export function parseNaira(input: string): number | null {
  const cleaned = input.replace(/[₦,\s]/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
}
