import { ApiError } from '../api/client';

/**
 * The stops a refused quote says are outside the areas where Jiffo works, by position, each once and in order:
 * empty when it doesn't say which, and null when the quote was refused for another reason.
 */
export function outsideStops(error: unknown, count: number): number[] | null {
  if (!(error instanceof ApiError) || error.code !== 'outside_service_area') return null;
  const named = Array.isArray(error.details.stops) ? error.details.stops : [];
  const valid = named.filter((i): i is number => Number.isInteger(i) && i >= 0 && i < count);
  return [...new Set(valid)].sort((a, b) => a - b);
}

/** What the customer is told when stops are outside the areas, naming each place once. */
export function outsideMessage(stops: Array<{ name: string }>, indexes: number[]) {
  const names = [...new Set(indexes.map((i) => stops[i]?.name).filter((n): n is string => !!n))];
  if (!names.length) return "Jiffo doesn't work there yet. Change the stops to places where Jiffo works.";
  if (names.length === 1) return `Jiffo doesn't work at ${names[0]} yet. Change it to a place where Jiffo works.`;
  const list = `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
  return `Jiffo doesn't work at ${list} yet. Change them to places where Jiffo works.`;
}
