'use client';

import { Fragment, type ReactNode } from 'react';

interface Props {
  content: string;
  mentions: string[];
  roles: { id: string; name: string; color: string }[];
  asCard: boolean;
  channel?: string;
}

const PERSIAN = /[؀-ۿ]/;

/* ── inline formatting ─────────────────────────────────────────── */

/** Longest markers first, so ** is never mistaken for two * . */
const INLINE: [RegExp, (body: ReactNode, key: string) => ReactNode][] = [
  [/`([^`\n]+)`/, (b, k) => <code key={k} className="rounded bg-ink-950/80 px-1 py-0.5 font-mono text-[0.85em] text-mist-100">{b}</code>],
  [/\*\*([^*]+)\*\*/, (b, k) => <strong key={k} className="font-semibold text-white">{b}</strong>],
  [/__([^_]+)__/, (b, k) => <u key={k}>{b}</u>],
  [/~~([^~]+)~~/, (b, k) => <s key={k} className="opacity-70">{b}</s>],
  [/\*([^*]+)\*/, (b, k) => <em key={k}>{b}</em>],
];

function inline(text: string, keyBase: string): ReactNode[] {
  for (const [re, wrap] of INLINE) {
    const m = re.exec(text);
    if (!m) continue;
    return [
      ...inline(text.slice(0, m.index), `${keyBase}a`),
      wrap(inline(m[1]!, `${keyBase}b`), `${keyBase}w`),
      ...inline(text.slice(m.index + m[0].length), `${keyBase}c`),
    ];
  }
  return [mentions(text, keyBase)];
}

/** Role and everyone pings render as Discord's blue chips. */
function mentions(text: string, keyBase: string): ReactNode {
  const parts = text.split(/(<@&\d+>|@everyone|@here)/g);
  return (
    <Fragment key={keyBase}>
      {parts.map((p, i) => {
        if (/^<@&\d+>$/.test(p) || p === '@everyone' || p === '@here') {
          return (
            <span key={i} className="rounded bg-brand-500/25 px-1 font-medium text-brand-400">
              {p.startsWith('<@&') ? '@role' : p}
            </span>
          );
        }
        return <Fragment key={i}>{p}</Fragment>;
      })}
    </Fragment>
  );
}

/* ── block layout ──────────────────────────────────────────────── */

function blocks(content: string): ReactNode[] {
  const lines = content.split('\n');
  const out: ReactNode[] = [];
  // Held on an object: TypeScript cannot follow a `let` reassigned inside a
  // closure, and narrows it to null for the code after the loop.
  const open: { fence: string[] | null } = { fence: null };

  lines.forEach((line, i) => {
    if (line.trim().startsWith('```')) {
      if (open.fence) {
        out.push(
          <pre key={`f${i}`} className="my-1 overflow-x-auto rounded-md border border-ink-700 bg-ink-950/80 p-2
                                        font-mono text-[0.8em] text-mist-100">{open.fence.join('\n')}</pre>);
        open.fence = null;
      } else open.fence = [];
      return;
    }
    if (open.fence) { open.fence.push(line); return; }

    if (line.startsWith('-# ')) {
      out.push(<div key={i} className="text-[0.8em] text-mist-400">{inline(line.slice(3), `k${i}`)}</div>);
    } else if (line.startsWith('### ')) {
      out.push(<div key={i} className="mt-1 text-[1.05em] font-semibold text-white">{inline(line.slice(4), `k${i}`)}</div>);
    } else if (line.startsWith('## ')) {
      out.push(<div key={i} className="mt-1 text-[1.2em] font-semibold text-white">{inline(line.slice(3), `k${i}`)}</div>);
    } else if (line.startsWith('# ')) {
      out.push(<div key={i} className="mt-1 text-[1.4em] font-bold text-white">{inline(line.slice(2), `k${i}`)}</div>);
    } else if (line.startsWith('> ')) {
      out.push(
        <div key={i} className="my-0.5 border-l-[3px] border-ink-600 pl-2.5 text-mist-200">
          {inline(line.slice(2), `k${i}`)}
        </div>);
    } else if (/^[-*] /.test(line)) {
      out.push(<div key={i} className="pl-3">• {inline(line.slice(2), `k${i}`)}</div>);
    } else if (line.trim() === '') {
      out.push(<div key={i} className="h-2" />);
    } else {
      out.push(<div key={i}>{inline(line, `k${i}`)}</div>);
    }
  });

  if (open.fence) {
    out.push(<pre key="ftail" className="my-1 rounded-md bg-ink-950/80 p-2 font-mono text-[0.8em]">{open.fence.join('\n')}</pre>);
  }
  return out;
}

/* ── the message ───────────────────────────────────────────────── */

export function DiscordPreview({ content, mentions: picked, roles, asCard, channel }: Props) {
  const pingLine = picked
    .map(m => (m === 'everyone' ? '@everyone' : `<@&${m}>`))
    .join(' ');
  const full = pingLine ? `${pingLine}\n\n${content}` : content;

  // Discord applies unicode-bidi: plaintext to cozy message bodies, but not
  // inside a container. Persian in a card keeps the punctuation on the wrong
  // side, and this is the only place anyone would find that out before sending.
  const persian = PERSIAN.test(content);
  const body = (
    <div className="whitespace-pre-wrap break-words text-[15px] leading-[1.45] text-mist-100"
      style={asCard ? undefined : { unicodeBidi: 'plaintext' }}>
      {blocks(full || '…')}
    </div>
  );

  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs text-mist-400">
        <span>Preview{channel ? ` · #${channel}` : ''}</span>
        <span className="text-[11px]">as Discord will draw it</span>
      </div>

      <div className="rounded-xl border border-ink-700/70 bg-[#313338] p-4">
        <div className="flex gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br
                          from-brand-500 to-sky-glow text-xs font-bold text-white">A</div>
          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-[15px] font-medium text-white">AION</span>
              <span className="rounded bg-brand-500 px-1 py-px text-[10px] font-semibold uppercase text-white">bot</span>
              <span className="text-[11px] text-mist-400">
                Today at {new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>

            {asCard ? (
              <div className="overflow-hidden rounded-[4px] bg-[#2b2d31]">
                <div className="flex">
                  <div className="w-1 shrink-0 bg-brand-500" />
                  <div className="min-w-0 flex-1 px-3 py-2.5">{body}</div>
                </div>
              </div>
            ) : body}
          </div>
        </div>
      </div>

      {persian && asCard ? (
        <p className="mt-2 rounded-lg border border-warn/25 bg-warn/[0.06] px-3 py-2 text-xs text-warn">
          Persian inside a card: Discord does not apply bidi isolation to container text, so
          punctuation and numbers can land on the wrong side. Untick “styled card” if it reads badly.
        </p>
      ) : null}

      <p className="mt-2 text-xs text-mist-400">
        Only the roles you tick can actually ping. Everything else renders as a mention but notifies nobody.
      </p>
    </div>
  );
}
