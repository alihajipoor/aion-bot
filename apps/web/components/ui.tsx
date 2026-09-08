import type { ReactNode } from 'react';

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-ink-700/70 bg-ink-850/70 backdrop-blur-sm
                     shadow-[0_1px_0_0_rgba(255,255,255,0.04)_inset,0_18px_40px_-24px_rgba(0,0,0,0.9)]
                     ${className}`}>
      {children}
    </div>
  );
}

export function Stat({ label, value, hint, accent = 'brand' }: {
  label: string; value: ReactNode; hint?: string;
  accent?: 'brand' | 'good' | 'warn' | 'bad' | 'sky';
}) {
  const bar = {
    brand: 'from-brand-500 to-brand-400',
    good: 'from-good to-good/40',
    warn: 'from-warn to-warn/40',
    bad: 'from-bad to-bad/40',
    sky: 'from-sky-glow to-sky-glow/40',
  }[accent];
  return (
    <Card className="overflow-hidden">
      <div className={`h-[3px] w-full bg-gradient-to-r ${bar}`} />
      <div className="p-5">
        <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-mist-400">{label}</div>
        <div className="mt-2 text-3xl font-semibold tabular-nums text-mist-50">{value}</div>
        {hint ? <div className="mt-1 text-xs text-mist-400">{hint}</div> : null}
      </div>
    </Card>
  );
}

export function SectionTitle({ children, sub }: { children: ReactNode; sub?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-lg font-semibold text-mist-50">{children}</h2>
      {sub ? <p className="mt-0.5 text-sm text-mist-400">{sub}</p> : null}
    </div>
  );
}

export function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'bad' }) {
  const cls = {
    neutral: 'bg-ink-700/70 text-mist-200 ring-ink-600',
    good: 'bg-good/10 text-good ring-good/25',
    warn: 'bg-warn/10 text-warn ring-warn/25',
    bad: 'bg-bad/10 text-bad ring-bad/25',
  }[tone];
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${cls}`}>{children}</span>;
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <Card className="p-10 text-center">
      <div className="text-base font-medium text-mist-200">{title}</div>
      <p className="mx-auto mt-1 max-w-sm text-sm text-mist-400">{body}</p>
    </Card>
  );
}
