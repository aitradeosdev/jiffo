/**
 * What the customer is told when stops are outside the areas where Jiffo works (`outside_service_area`, whose
 * `stops` are their positions in the errand), naming them so they know which to change.
 */
export function outsideMessage(stops: Array<{ name: string }>, indexes: number[]) {
  const names = indexes.map((i) => stops[i]?.name).filter((n): n is string => !!n);
  if (!names.length) return "Jiffo doesn't work there yet. Change the stops to places where Jiffo works.";
  if (names.length === 1) return `Jiffo doesn't work at ${names[0]} yet. Change it to a place where Jiffo works.`;
  const list = `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
  return `Jiffo doesn't work at ${list} yet. Change them to places where Jiffo works.`;
}
