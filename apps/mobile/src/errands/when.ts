/** "Now", or the scheduled day and time, like "Sat, 14 Nov · 10:00 AM". */
export function whenLabel(scheduledFor: string | null) {
  if (!scheduledFor) return 'Now';
  const at = new Date(scheduledFor);
  if (at.getTime() <= Date.now()) return 'Now';
  const day = at.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const time = at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const [weekday, ...rest] = day.replace(',', '').split(' ');
  return `${weekday}, ${rest.join(' ')} · ${time}`;
}

/** The API takes a schedule only this far ahead; nearer than that it must be sent now. */
export const SCHEDULE_LEAD_MS = 15 * 60 * 1000;

/** A draft's schedule, while it can still be sent as one. */
export const liveSchedule = (scheduledFor: string | null) =>
  scheduledFor && new Date(scheduledFor).getTime() >= Date.now() + SCHEDULE_LEAD_MS ? scheduledFor : null;

/** A draft's schedule that has come too close or passed: the customer must pick again or send now. */
export const staleSchedule = (scheduledFor: string | null) => !!scheduledFor && !liveSchedule(scheduledFor);

/** A sent errand's schedule, while it is still ahead. */
export const upcoming = (scheduledFor: string | null) =>
  scheduledFor && new Date(scheduledFor).getTime() > Date.now() ? scheduledFor : null;

/** "Today, 6:12 PM", "Yesterday, 6:12 PM" or "4 Nov, 11:40 AM", for lists. */
export function shortWhen(iso: string) {
  const at = new Date(iso);
  const time = at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${dayLabel(at)}, ${time}`;
}

/** "Today", "Yesterday" or "4 Nov", for grouping by day. */
export function dayLabel(at: Date) {
  const days = Math.round((startOfDay(new Date()) - startOfDay(at)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
