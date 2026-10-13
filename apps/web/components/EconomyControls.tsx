'use client';

import { useActionState, useState } from 'react';
import {
  launchAction, rulesAction, productAction, removeProductAction, imageAction, orderAction,
  adjustAction, freezeAction, inviteAction, type EcoResult,
} from '@/app/dashboard/economy/actions';
import type { Economy, Product } from '@/lib/eco';

/**
 * The economy page's controls. Every form is disabled for anyone who is not a
 * Dev — `canEdit` comes from the server — and the server actions check again,
 * so the disabled state is a courtesy, not the guard.
 */

const btn = 'rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:opacity-40';
const primary = `${btn} bg-brand-500 text-white hover:bg-brand-400`;
const good = `${btn} bg-good/15 text-good hover:bg-good/25`;
const bad = `${btn} bg-bad/15 text-bad hover:bg-bad/25`;
const quiet = `${btn} bg-ink-800 text-mist-200 hover:bg-ink-700`;
const field = 'w-full rounded-lg border border-ink-700 bg-ink-900 px-2.5 py-1.5 text-sm text-mist-50 ' +
  'outline-none transition placeholder:text-mist-400/60 focus:border-brand-500 disabled:opacity-50';
const label = 'text-[11px] uppercase tracking-[0.12em] text-mist-400';

function Status({ state }: { state: EcoResult | null }) {
  if (!state) return null;
  return <span role="status" aria-live="polite" className={`text-xs ${state.ok ? 'text-good' : 'text-bad'}`}>{state.message}</span>;
}

function Field({ name, title, hint, children }: { name?: string; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1" htmlFor={name}>
      <span className={label}>{title}</span>
      {children}
      {hint ? <span className="text-[11px] text-mist-400/80">{hint}</span> : null}
    </label>
  );
}

/* ── launch ────────────────────────────────────────────────────── */

export function LaunchToggle({ enabled, canEdit }: { enabled: boolean; canEdit: boolean }) {
  const [state, action, pending] = useActionState<EcoResult | null, FormData>(launchAction, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3"
      onSubmit={e => { if (enabled && !confirm('Pause the economy? Earning and buying stop; balances stay.')) e.preventDefault(); }}>
      <input type="hidden" name="enabled" value={enabled ? '0' : '1'} />
      <button disabled={!canEdit || pending} className={enabled ? bad : good}>{enabled ? 'Pause economy' : 'Launch economy'}</button>
      <Status state={state} />
    </form>
  );
}

/* ── rules ─────────────────────────────────────────────────────── */

export function RulesForm({ economy, canEdit }: { economy: Economy; canEdit: boolean }) {
  const [state, action, pending] = useActionState<EcoResult | null, FormData>(rulesAction, null);
  const num = (name: keyof Economy, title: string, hint?: string) => (
    <Field name={name} title={title} hint={hint}>
      <input id={name} name={name} type="number" required defaultValue={String(economy[name] ?? '')} disabled={!canEdit} className={field} />
    </Field>
  );
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {num('minutesPerCoin', 'Minutes per coin', '60 = 1 coin an hour')}
      {num('tagMultiplier', 'Server-tag multiplier', 'Voice earns this many times faster while wearing the AION tag; invites unchanged')}
      {num('minAccountAgeDays', 'Minimum account age (days)', 'Younger accounts neither earn nor pay their inviter')}
      {num('inviteCoins', 'Coins per verified invite')}
      {num('inviteRevokeHours', 'Take the invite coin back if they leave within (hours)')}
      {num('inactivityDays', 'Coins expire after (days without voice)')}
      {num('inactivityWarnDays', 'DM a warning this many days before')}
      {num('minMemberDaysToBuy', 'Days in the server before buying', '0 = off')}
      <Field name="excludedChannels" title="Voice rooms that never earn" hint="Comma-separated words from the room name; AFK is always excluded">
        <input id="excludedChannels" name="excludedChannels" defaultValue={economy.excludedChannels.join(', ')} disabled={!canEdit} className={field} />
      </Field>
      <div className="flex flex-col justify-end gap-2 text-sm text-mist-200">
        <label className="flex items-center gap-2"><input type="checkbox" name="requireCompany" defaultChecked={economy.requireCompany} disabled={!canEdit} /> Need someone else in the room</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="excludeDeafened" defaultChecked={economy.excludeDeafened} disabled={!canEdit} /> Deafened time does not earn</label>
      </div>
      <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-3">
        <button disabled={!canEdit || pending} className={primary}>Save rules</button>
        <Status state={state} />
      </div>
    </form>
  );
}

/* ── products ──────────────────────────────────────────────────── */

export function ProductForm({ product, canEdit, onDone }: { product?: Product; canEdit: boolean; onDone?: () => void }) {
  const [state, action, pending] = useActionState<EcoResult | null, FormData>(async (p, f) => {
    const r = await productAction(p, f);
    if (r.ok) onDone?.();
    return r;
  }, null);
  const p = product;
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {p ? <input type="hidden" name="id" value={p.id} /> : null}
      <div className="sm:col-span-2"><Field name={`name-${p?.id ?? 'new'}`} title="Name">
        <input id={`name-${p?.id ?? 'new'}`} name="name" required defaultValue={p?.name ?? ''} placeholder="Discord Nitro — 1 mah" disabled={!canEdit} className={field} />
      </Field></div>
      <Field title="Price (coins)"><input name="price" type="number" min={1} required defaultValue={p?.price ?? ''} disabled={!canEdit} className={field} /></Field>
      <Field title="Order in shop" hint="Lower comes first"><input name="sortOrder" type="number" defaultValue={p?.sortOrder ?? 100} disabled={!canEdit} className={field} /></Field>
      <Field title="Stock per month" hint="Empty = unlimited. This is the budget">
        <input name="stockPerMonth" type="number" min={0} defaultValue={p?.stockPerMonth ?? ''} disabled={!canEdit} className={field} />
      </Field>
      <Field title="Per member per month" hint="Empty = unlimited"><input name="perUserMonth" type="number" min={1} defaultValue={p?.perUserMonth ?? ''} disabled={!canEdit} className={field} /></Field>
      <div className="sm:col-span-2"><Field title="Short description" hint="Shown in the shop">
        <input name="description" defaultValue={p?.description ?? ''} maxLength={200} disabled={!canEdit} className={field} />
      </Field></div>
      <div className="sm:col-span-2 lg:col-span-3"><Field title="Note for the buyer" hint="Shown before they confirm — region, what ID to send">
        <input name="note" defaultValue={p?.note ?? ''} maxLength={400} disabled={!canEdit} className={field} />
      </Field></div>
      {!p ? <Field title="Picture (optional)" hint="Square works best; shrunk to 192px">
        <input name="image" type="file" accept="image/png,image/jpeg,image/gif,image/webp" disabled={!canEdit} className="text-xs text-mist-300" />
      </Field> : null}
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2 lg:col-span-4">
        <label className="flex items-center gap-2 text-sm text-mist-200"><input type="checkbox" name="active" defaultChecked={p ? p.active : true} disabled={!canEdit} /> In the shop</label>
        <button disabled={!canEdit || pending} className={primary}>{p ? 'Save' : 'Add product'}</button>
        <Status state={state} />
      </div>
    </form>
  );
}

export function ProductRow({ product, canEdit }: { product: Product; canEdit: boolean }) {
  const [open, setOpen] = useState(false);
  const [imgState, imgAction, imgPending] = useActionState<EcoResult | null, FormData>(imageAction, null);
  const [rmState, rmAction, rmPending] = useActionState<EcoResult | null, FormData>(removeProductAction, null);
  const p = product;
  const left = p.stockPerMonth === null ? null : Math.max(0, p.stockPerMonth - p.soldThisMonth);
  return (
    <div className="px-5 py-4">
      <div className="flex flex-wrap items-center gap-4">
        {p.image
          ? <img src={p.image} alt="" className="h-12 w-12 rounded-xl border border-ink-700 object-cover" />
          : <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-ink-800 text-lg font-semibold text-mist-300">{p.name.trim()[0]?.toUpperCase()}</div>}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs text-mist-400">#{p.id}</span>
            <span className={`truncate text-sm font-medium ${p.active ? 'text-mist-50' : 'text-mist-400 line-through'}`}>{p.name}</span>
          </div>
          <div className="mt-0.5 text-xs text-mist-400">
            {p.price} coin · sold this month {p.soldThisMonth}{p.stockPerMonth !== null ? ` of ${p.stockPerMonth} (${left} left)` : ' (unlimited)'}
            {p.perUserMonth !== null ? ` · ${p.perUserMonth} per member` : ''}{p.active ? '' : ' · off the shop'}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <form action={imgAction} className="flex items-center gap-2">
            <input type="hidden" name="id" value={p.id} />
            <input name="image" type="file" accept="image/png,image/jpeg,image/gif,image/webp" disabled={!canEdit} className="w-44 text-[11px] text-mist-300" />
            <button disabled={!canEdit || imgPending} className={quiet}>Set picture</button>
          </form>
          {p.image ? (
            <form action={imgAction}>
              <input type="hidden" name="id" value={p.id} /><input type="hidden" name="clear" value="1" />
              <button disabled={!canEdit || imgPending} className={quiet}>Clear picture</button>
            </form>
          ) : null}
          <button type="button" onClick={() => setOpen(o => !o)} className={quiet}>{open ? 'Close' : 'Edit'}</button>
          {p.active ? (
            <form action={rmAction} onSubmit={e => { if (!confirm(`Take "${p.name}" off the shop? Its order history stays.`)) e.preventDefault(); }}>
              <input type="hidden" name="id" value={p.id} />
              <button disabled={!canEdit || rmPending} className={bad}>Remove</button>
            </form>
          ) : null}
        </div>
      </div>
      <div className="mt-1 flex gap-3"><Status state={imgState} /><Status state={rmState} /></div>
      {open ? <div className="mt-4 rounded-xl border border-ink-700/60 p-4"><ProductForm product={p} canEdit={canEdit} onDone={() => setOpen(false)} /></div> : null}
    </div>
  );
}

/* ── orders ────────────────────────────────────────────────────── */

export function OrderActions({ id, canEdit }: { id: number; canEdit: boolean }) {
  const [state, action, pending] = useActionState<EcoResult | null, FormData>(orderAction, null);
  const [mode, setMode] = useState<'send' | 'reject' | null>(null);
  if (!canEdit) return null;
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <button type="button" onClick={() => setMode(m => m === 'send' ? null : 'send')} className={good}>Send code</button>
        <form action={action}>
          <input type="hidden" name="id" value={id} /><input type="hidden" name="mode" value="done" />
          <button disabled={pending} className={quiet} title="Delivered some other way">Mark delivered</button>
        </form>
        <button type="button" onClick={() => setMode(m => m === 'reject' ? null : 'reject')} className={bad}>Reject + refund</button>
      </div>
      {mode ? (
        <form action={action} className="flex w-full max-w-md flex-col gap-2">
          <input type="hidden" name="id" value={id} /><input type="hidden" name="mode" value={mode} />
          <textarea name="text" required rows={3} maxLength={1500} className={field}
            placeholder={mode === 'send' ? 'The code or message — it is DMed to the buyer and never stored' : 'Why — the buyer is told'} />
          <button disabled={pending} className={mode === 'send' ? primary : bad}>{mode === 'send' ? 'DM the code and mark delivered' : 'Reject and refund'}</button>
        </form>
      ) : null}
      <Status state={state} />
    </div>
  );
}

/* ── members ───────────────────────────────────────────────────── */

export function AdjustForm({ userId, canEdit }: { userId: string; canEdit: boolean }) {
  const [state, action, pending] = useActionState<EcoResult | null, FormData>(adjustAction, null);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="userId" value={userId} />
      <Field title="Give / take">
        <select name="direction" disabled={!canEdit} className={field}><option value="give">Give</option><option value="take">Take</option></select>
      </Field>
      <Field title="Coins"><input name="amount" type="number" min={1} required disabled={!canEdit} className={`${field} w-28`} /></Field>
      <div className="min-w-52 flex-1"><Field title="Reason (logged)"><input name="reason" required maxLength={200} disabled={!canEdit} className={field} /></Field></div>
      <button disabled={!canEdit || pending} className={primary}>Apply</button>
      <Status state={state} />
    </form>
  );
}

export function FreezeButton({ userId, frozen, canEdit }: { userId: string; frozen: boolean; canEdit: boolean }) {
  const [state, action, pending] = useActionState<EcoResult | null, FormData>(freezeAction, null);
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="userId" value={userId} /><input type="hidden" name="frozen" value={frozen ? '0' : '1'} />
      <button disabled={!canEdit || pending} className={frozen ? good : bad}>{frozen ? 'Unfreeze' : 'Freeze'}</button>
      <Status state={state} />
    </form>
  );
}

/* ── held invites ──────────────────────────────────────────────── */

export function InviteActions({ inviteeId, canEdit }: { inviteeId: string; canEdit: boolean }) {
  const [state, action, pending] = useActionState<EcoResult | null, FormData>(inviteAction, null);
  if (!canEdit) return null;
  return (
    <div className="flex items-center gap-2">
      {(['1', '0'] as const).map(v => (
        <form key={v} action={action}>
          <input type="hidden" name="inviteeId" value={inviteeId} /><input type="hidden" name="approve" value={v} />
          <button disabled={pending} className={v === '1' ? good : bad}>{v === '1' ? 'Confirm' : 'Reject'}</button>
        </form>
      ))}
      <Status state={state} />
    </div>
  );
}
