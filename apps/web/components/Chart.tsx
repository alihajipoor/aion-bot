import { Card } from './ui';

export interface Point { day: string; value: number }

/**
 * Inline SVG so the chart renders on the server — no client bundle, no
 * hydration flash, and it works with JavaScript disabled.
 */
export function AreaChart({ title, points, accent, format }: {
  title: string; points: Point[]; accent: string; format?: (n: number) => string;
}) {
  const W = 560, H = 140, PAD = 6;
  const max = Math.max(1, ...points.map(p => p.value));
  const step = points.length > 1 ? (W - PAD * 2) / (points.length - 1) : 0;
  const y = (v: number) => H - PAD - (v / max) * (H - PAD * 2);
  const xs = points.map((_, i) => PAD + i * step);

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${xs[i]!.toFixed(1)},${y(p.value).toFixed(1)}`).join(' ');
  const area = `${line} L${xs[xs.length - 1] ?? PAD},${H - PAD} L${xs[0] ?? PAD},${H - PAD} Z`;
  const id = title.replace(/\W/g, '');
  const total = points.reduce((n, p) => n + p.value, 0);
  const fmt = format ?? ((n: number) => String(n));

  return (
    <Card className="overflow-hidden p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="text-sm font-medium text-mist-200">{title}</h3>
        <span className="text-xs tabular-nums text-mist-400">{fmt(total)} total</span>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${title} over time`}>
        <defs>
          <linearGradient id={`g-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accent} stopOpacity="0.35" />
            <stop offset="100%" stopColor={accent} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map(f => (
          <line key={f} x1={PAD} x2={W - PAD} y1={H * f} y2={H * f}
            stroke="currentColor" strokeOpacity="0.06" className="text-mist-50" />
        ))}
        {points.length > 1 ? (
          <>
            <path d={area} fill={`url(#g-${id})`} />
            <path d={line} fill="none" stroke={accent} strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" />
          </>
        ) : null}
        {points.map((p, i) => (
          <circle key={p.day} cx={xs[i]} cy={y(p.value)} r={i === points.length - 1 ? 3.5 : 0}
            fill={accent} />
        ))}
      </svg>

      <div className="mt-2 flex justify-between text-[10px] text-mist-400/70">
        <span>{points[0]?.day.slice(5) ?? ''}</span>
        <span>{points[points.length - 1]?.day.slice(5) ?? ''}</span>
      </div>
    </Card>
  );
}

/** Compact horizontal ranking used on the overview. */
export function MiniBars({ title, rows, accent, format }: {
  title: string; rows: { label: string; value: number }[]; accent: string;
  format?: (n: number) => string;
}) {
  const max = Math.max(1, ...rows.map(r => r.value));
  const fmt = format ?? ((n: number) => String(n));
  return (
    <Card className="p-5">
      <h3 className="mb-4 text-sm font-medium text-mist-200">{title}</h3>
      {rows.length ? (
        <ol className="space-y-3">
          {rows.map((r, i) => (
            <li key={r.label + i}>
              <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
                <span className="min-w-0 truncate text-mist-200">{r.label}</span>
                <span className="shrink-0 tabular-nums text-mist-400">{fmt(r.value)}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-ink-700/60">
                <div className="h-full rounded-full" style={{
                  width: `${Math.max(3, (r.value / max) * 100)}%`,
                  background: `linear-gradient(90deg, ${accent}, ${accent}66)`,
                }} />
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-mist-400">No activity recorded yet.</p>
      )}
    </Card>
  );
}
