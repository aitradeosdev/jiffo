/** Money is kept in kobo (or the country's smallest unit); shown in whole naira unless there are kobo. */
export function money(kobo: number, currency = 'NGN'): string {
  const whole = kobo % 100 === 0;
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(kobo / 100);
}

export const count = (n: number) => new Intl.NumberFormat('en-NG').format(n);

/** A date and time in the country's own time zone, e.g. "13 Nov, 14:05". */
export function dateTime(iso: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

/** "just now", "5 min ago", "3 h ago", or the date for anything older than a day. */
export function ago(iso: string | Date, timeZone: string, now = Date.now()): string {
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h ago`;
  return dateTime(iso, timeZone);
}

/** Naira as someone types it ("1,500", "₦2500.50", "") to whole kobo. Empty is zero; anything else is NaN. */
export function nairaToKobo(text: string): number {
  const cleaned = text.replace(/[,\s₦]/g, '');
  if (cleaned === '') return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return NaN;
  return Math.round(Number(cleaned) * 100);
}

/** How long something has waited: "under a minute", "5 min", "3 h", "2 days". */
export function waited(iso: string | Date, now = Date.now()): string {
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)} h`;
  return `${Math.floor(minutes / (24 * 60))} days`;
}

/** "Mon 10" for a YYYY-MM-DD day. */
export function shortDay(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric' }).format(date);
}
