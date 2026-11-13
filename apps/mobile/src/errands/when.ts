/** "Now", or the scheduled day and time, like "Sat, 14 Nov · 10:00 AM". */
export function whenLabel(scheduledFor: string | null, timeZone?: string) {
  if (!scheduledFor) return 'Now';
  const at = new Date(scheduledFor);
  if (at.getTime() <= Date.now()) return 'Now';
  const day = at.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone });
  const time = at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone });
  const [weekday, ...rest] = day.replace(',', '').split(' ');
  return `${weekday}, ${rest.join(' ')} · ${time}`;
}

/** A schedule still counts only while it is in the future. */
export const liveSchedule = (scheduledFor: string | null) =>
  scheduledFor && new Date(scheduledFor).getTime() > Date.now() ? scheduledFor : null;
