import { cloneElement, useId, type ReactElement, type ReactNode } from 'react';

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

export const buttonClass = (kind: 'primary' | 'secondary' | 'danger' | 'ghost' = 'primary', small = false) =>
  cx(
    'inline-flex items-center justify-center gap-2 rounded-full font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
    small ? 'h-9 px-4 text-sm' : 'h-11 px-5 text-[15px]',
    kind === 'primary' && 'bg-ink text-on-ink hover:opacity-90',
    kind === 'secondary' && 'bg-surface-2 text-ink hover:bg-line',
    kind === 'danger' && 'bg-danger-soft text-danger hover:opacity-80',
    kind === 'ghost' && 'text-ink-2 hover:bg-surface-2',
  );

export const inputClass =
  'h-11 w-full rounded-xl border-2 border-transparent bg-surface-2 px-3.5 text-[15px] text-ink placeholder:text-ink-3 focus:border-ink focus:bg-surface focus:outline-none';

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[28px] leading-tight font-extrabold tracking-tight">{title}</h1>
        {subtitle ? <p className="mt-1 text-[15px] text-ink-3">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Card({
  title,
  action,
  children,
  className,
  padded = true,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section className={cx('rounded-2xl border border-line bg-surface', className)}>
      {title ? (
        <header
          className={cx(
            'flex items-center justify-between gap-3',
            padded ? 'px-5 pt-4' : 'border-b border-line px-5 py-4',
          )}
        >
          <h2 className="text-[15px] font-bold">{title}</h2>
          {action}
        </header>
      ) : null}
      <div className={cx(padded && 'p-5', padded && !!title && 'pt-3')}>{children}</div>
    </section>
  );
}

type Tone = 'neutral' | 'brand' | 'warn' | 'danger';
const TONE: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-ink-2',
  brand: 'bg-brand-soft text-brand-ink',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
};

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cx(
        'inline-flex h-6 items-center rounded-full px-2.5 text-xs font-semibold whitespace-nowrap',
        TONE[tone],
      )}
    >
      {children}
    </span>
  );
}

/** One number with its label, for the overview. */
export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'warn' | 'danger';
}) {
  return (
    <div className="min-w-0">
      <div className="text-[13px] font-medium text-ink-3">{label}</div>
      <div
        className={cx(
          'num mt-1 truncate text-2xl font-extrabold tracking-tight',
          tone === 'warn' && 'text-warn',
          tone === 'danger' && 'text-danger',
        )}
      >
        {value}
      </div>
      {hint ? <div className="mt-0.5 text-[13px] text-ink-3">{hint}</div> : null}
    </div>
  );
}

/**
 * A labelled form field. The hint sits outside the label and is linked as the field's description, so a
 * screen reader reads the label as the name and the hint after it.
 */
export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactElement }) {
  const id = useId();
  const field = hint
    ? cloneElement(children as ReactElement<{ 'aria-describedby'?: string }>, { 'aria-describedby': `${id}-hint` })
    : children;
  return (
    <div>
      <label className="block">
        <span className="mb-1.5 block text-sm font-semibold">{label}</span>
        {field}
      </label>
      {hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-[13px] text-ink-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** A message under a form: what went wrong, or what happened. */
export function Notice({ tone = 'danger', children }: { tone?: 'danger' | 'brand' | 'warn'; children: ReactNode }) {
  if (!children) return null;
  return (
    <p
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cx('rounded-xl px-3.5 py-2.5 text-sm font-medium', TONE[tone])}
    >
      {children}
    </p>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-5 py-10 text-center">
      <p className="font-bold">{title}</p>
      {children ? <p className="mt-1 text-sm text-ink-3">{children}</p> : null}
    </div>
  );
}

export const tableClass = 'w-full text-left text-sm';
export const thClass = 'px-5 py-3 text-[13px] font-semibold text-ink-3 whitespace-nowrap';
export const tdClass = 'px-5 py-3.5 align-middle';
