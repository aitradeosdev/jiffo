export interface Column {
  /** Under the column, e.g. "Fri 13". */
  label: string;
  value: number;
  /** The value as people read it, e.g. "₦12,400". */
  shown: string;
}

const HEIGHT = 140;

/**
 * One series of columns from a single baseline: thin columns with rounded tops, the latest value labelled
 * on its cap, every value in a tooltip on hover or keyboard focus, and the same numbers in a table for
 * screen readers. The card's title names the series, so there is no legend.
 */
export function ColumnChart({ title, columns, empty }: { title: string; columns: Column[]; empty: string }) {
  const max = Math.max(...columns.map((c) => c.value), 0);
  const last = columns.length - 1;
  return (
    <figure className="m-0">
      <div className="relative flex items-end gap-1" style={{ height: HEIGHT + 24 }} aria-hidden="true">
        {/* The baseline. */}
        <div className="absolute inset-x-0 border-t border-line" style={{ bottom: 0 }} />
        {max === 0 ? (
          <p className="absolute inset-x-0 text-center text-sm text-ink-3" style={{ bottom: HEIGHT / 2 }}>
            {empty}
          </p>
        ) : null}
        {columns.map((c, i) => {
          const h = max === 0 ? 0 : Math.max(c.value > 0 ? 3 : 0, Math.round((c.value / max) * HEIGHT));
          return (
            <div
              key={c.label}
              tabIndex={0}
              className="group relative flex h-full flex-1 flex-col items-center justify-end outline-none"
            >
              {i === last && max > 0 ? <span className="num mb-1 text-xs font-bold text-ink">{c.shown}</span> : null}
              <div
                className="w-full max-w-6 rounded-t-[4px] bg-chart transition-opacity group-hover:opacity-80 group-focus-visible:opacity-80"
                style={{ height: h }}
              />
              <span
                role="tooltip"
                className="pointer-events-none absolute z-10 hidden -translate-y-2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs whitespace-nowrap shadow-sm group-hover:block group-focus-visible:block"
                style={{ bottom: h + 4 }}
              >
                <span className="num block font-bold text-ink">{c.shown}</span>
                <span className="block text-ink-3">{c.label}</span>
              </span>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-1" aria-hidden="true">
        {columns.map((c, i) => (
          <span
            key={c.label}
            className={`flex-1 text-center text-xs ${i === last ? 'font-bold text-ink' : 'text-ink-3'}`}
          >
            {c.label}
          </span>
        ))}
      </div>
      <table className="sr-only">
        <caption>{title}</caption>
        <tbody>
          {columns.map((c) => (
            <tr key={c.label}>
              <th scope="row">{c.label}</th>
              <td>{c.shown}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
