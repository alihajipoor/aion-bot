'use client';

import type { ReactNode } from 'react';

export const inputCls =
  'w-full rounded-xl border border-ink-700 bg-ink-900/80 px-3.5 py-2.5 text-sm text-mist-50 ' +
  'outline-none transition placeholder:text-mist-400/60 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/25';

export function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-ink-700/70 bg-ink-850/60 p-6">
      <div className="mb-5">
        <h3 className="text-sm font-semibold tracking-tight text-mist-50">{title}</h3>
        {hint ? <p className="mt-1 text-xs leading-relaxed text-mist-400">{hint}</p> : null}
      </div>
      <div className="grid gap-5">{children}</div>
    </section>
  );
}

export function Field({ label, hint, children, htmlFor }: {
  label: string; hint?: string; children: ReactNode; htmlFor?: string;
}) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={htmlFor} className="text-xs font-medium uppercase tracking-[0.12em] text-mist-400">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs leading-relaxed text-mist-400/80">{hint}</p> : null}
    </div>
  );
}

export function Toggle({ name, label, hint, defaultChecked }: {
  name: string; label: string; hint?: string; defaultChecked?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-ink-700/60
                      bg-ink-900/40 px-4 py-3 transition hover:border-ink-600">
      <input type="checkbox" name={name} defaultChecked={defaultChecked}
        className="peer sr-only" />
      <span className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full bg-ink-700 transition
                       peer-checked:bg-brand-500
                       after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full
                       after:bg-white after:transition peer-checked:after:translate-x-4" />
      <span className="min-w-0">
        <span className="block text-sm text-mist-50">{label}</span>
        {hint ? <span className="mt-0.5 block text-xs leading-relaxed text-mist-400">{hint}</span> : null}
      </span>
    </label>
  );
}

export function Num({ name, defaultValue, min, max, suffix }: {
  name: string; defaultValue: number; min?: number; max?: number; suffix?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <input id={name} type="number" name={name} defaultValue={defaultValue} min={min} max={max}
        className={`${inputCls} max-w-32 tabular-nums`} />
      {suffix ? <span className="text-sm text-mist-400">{suffix}</span> : null}
    </div>
  );
}
