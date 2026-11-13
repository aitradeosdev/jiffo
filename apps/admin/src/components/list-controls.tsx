import Link from 'next/link';
import { buttonClass, inputClass } from './ui';

/** Filter pills and a search box above a list. */
export function ListControls({
  base,
  label,
  filters,
  current,
  link,
  q,
  placeholder,
  hidden,
}: {
  base: string;
  label: string;
  filters: ReadonlyArray<{ value: string; label: string }>;
  current: string;
  link: (filter: string) => string;
  q: string;
  placeholder: string;
  hidden?: Record<string, string>;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <nav aria-label={label} className="flex flex-wrap gap-1.5">
        {filters.map((f) => (
          <Link
            key={f.value}
            href={link(f.value)}
            aria-current={f.value === current ? 'page' : undefined}
            className={`h-9 rounded-full px-3.5 text-sm leading-9 font-semibold ${
              f.value === current ? 'bg-ink text-on-ink' : 'bg-surface text-ink-2 hover:bg-surface-2'
            }`}
          >
            {f.label}
          </Link>
        ))}
      </nav>
      <form action={base} className="flex w-full gap-2 sm:w-auto" role="search">
        {Object.entries(hidden ?? {}).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <label htmlFor="q" className="sr-only">
          Search
        </label>
        <input id="q" name="q" defaultValue={q} placeholder={placeholder} className={`${inputClass} h-9 sm:w-72`} />
        <button type="submit" className={buttonClass('primary', true)}>
          Search
        </button>
      </form>
    </div>
  );
}

/** Newest and Older links under a paged list. */
export function Pager({ newest, older }: { newest: string | null; older: string | null }) {
  if (!newest && !older) return null;
  return (
    <div className="mt-4 flex gap-2">
      {newest ? (
        <Link href={newest} className={buttonClass('secondary', true)}>
          Newest
        </Link>
      ) : null}
      {older ? (
        <Link href={older} className={buttonClass('secondary', true)}>
          Older
        </Link>
      ) : null}
    </div>
  );
}
