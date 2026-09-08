import Link from 'next/link';
import { Card } from '@/components/ui';

export interface Signal {
  id: string;
  tone: 'bad' | 'warn' | 'info';
  title: string;
  detail: string;
  href: string;
  cta: string;
}

const TONE = {
  bad:  { bar: 'bg-bad',  text: 'text-bad',  ring: 'border-bad/25 bg-bad/[0.05]' },
  warn: { bar: 'bg-warn', text: 'text-warn', ring: 'border-warn/25 bg-warn/[0.04]' },
  info: { bar: 'bg-sky-glow', text: 'text-sky-glow', ring: 'border-ink-700/70 bg-ink-850/70' },
} as const;

/**
 * "How is the server doing" is a question you ask once a month. The question an
 * admin opens the panel with is "what needs me right now", so that goes first
 * and the statistics move below it.
 */
export function Inbox({ signals }: { signals: Signal[] }) {
  if (!signals.length) {
    return (
      <Card className="mb-7 flex items-center gap-4 p-5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-good/10 text-good">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
            <path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z" />
          </svg>
        </span>
        <div>
          <div className="text-sm font-medium text-mist-50">Nothing needs you</div>
          <div className="text-xs text-mist-400">No pending reviews, no expiring punishments, nothing broken.</div>
        </div>
      </Card>
    );
  }

  return (
    <div className="mb-7 space-y-2">
      {signals.map(s => {
        const t = TONE[s.tone];
        return (
          <Link key={s.id} href={s.href}
            className={`group flex items-center gap-4 rounded-xl border px-4 py-3 transition
                        hover:border-ink-600 ${t.ring}`}>
            <span className={`h-8 w-[3px] shrink-0 rounded-full ${t.bar}`} />
            <div className="min-w-0 flex-1">
              <div className={`text-sm font-medium ${t.text}`}>{s.title}</div>
              <div className="truncate text-xs text-mist-400">{s.detail}</div>
            </div>
            <span className="shrink-0 text-xs text-mist-400 transition group-hover:text-mist-200">
              {s.cta} →
            </span>
          </Link>
        );
      })}
    </div>
  );
}
