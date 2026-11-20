interface Point {
  agentId: string;
  lat: number;
  lng: number;
  mocked: boolean;
}

/**
 * The agent's GPS trail drawn to scale, with the errand's stops (docs/security-plan.md, G1, E8): a line for
 * each agent who was out on it, where their phone said they were; red dots are positions the phone said were
 * mocked.
 */
export function TrailMap({
  points,
  stops,
}: {
  points: Point[];
  stops: Array<{ kind: string; lat: number; lng: number }>;
}) {
  const all = [...points, ...stops];
  if (!points.length) return null;
  const lat0 = all.reduce((s, p) => s + p.lat, 0) / all.length;
  const scale = Math.cos((lat0 * Math.PI) / 180);
  const xs = all.map((p) => p.lng * scale);
  const ys = all.map((p) => p.lat);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const span = Math.max(maxX - minX, maxY - minY, 1e-5);
  const W = 320;
  const H = 220;
  const pad = 14;
  const fit = Math.min((W - 2 * pad) / span, (H - 2 * pad) / span);
  const at = (p: { lat: number; lng: number }) => ({
    x: pad + (p.lng * scale - minX) * fit,
    y: H - pad - (p.lat - minY) * fit,
  });
  // One line per agent: an agent who gave the errand back and the next one aren't joined into a jump.
  const lines = [...new Set(points.map((p) => p.agentId))].map((agentId) =>
    points
      .filter((p) => p.agentId === agentId && !p.mocked)
      .map((p) => at(p))
      .map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`)
      .join(' '),
  );
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`The agent's trail: ${points.length} positions, with the errand's stops`}
      className="w-full rounded-xl bg-surface-2"
    >
      {lines.map((line, i) => (
        <polyline
          key={`l${i}`}
          points={line}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeDasharray={i ? '5 3' : undefined}
          className="text-chart"
        />
      ))}
      {points
        .filter((p) => p.mocked)
        .map((p, i) => {
          const q = at(p);
          return <circle key={`m${i}`} cx={q.x} cy={q.y} r={3} className="fill-danger" />;
        })}
      {stops.map((s, i) => {
        const q = at(s);
        return (
          <g key={`s${i}`}>
            <circle cx={q.x} cy={q.y} r={5} className={s.kind === 'dropoff' ? 'fill-ink' : 'fill-brand'} />
            <text x={q.x + 7} y={q.y + 4} className="fill-ink-2 text-[10px]">
              {s.kind === 'pickup' ? 'Pickup' : s.kind === 'dropoff' ? 'Drop-off' : 'Stop'}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
