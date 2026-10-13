import Link from 'next/link';
import { requireSession, isDev } from '@/lib/auth';
import { getOverview, getProducts, getOrders, getMember, getHeldInvites, getLog, type Entry } from '@/lib/eco';
import { Card, EmptyState, Pill, SectionTitle, Stat } from '@/components/ui';
import {
  LaunchToggle, RulesForm, ProductForm, ProductRow, OrderActions, AdjustForm, FreezeButton, InviteActions,
} from '@/components/EconomyControls';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const TABS = [
  ['overview', 'Overview'], ['products', 'Products'], ['orders', 'Orders'], ['members', 'Members'],
  ['invites', 'Held invites'], ['rules', 'Rules'], ['log', 'Log'],
] as const;
type Tab = typeof TABS[number][0];

const STATUS = ['pending', 'delivered', 'rejected', 'cancelled', 'all'] as const;
const TONE: Record<string, 'neutral' | 'good' | 'warn' | 'bad'> = { pending: 'warn', delivered: 'good', rejected: 'bad', cancelled: 'neutral' };
const KIND: Record<string, string> = {
  voice: 'voice', invite: 'invite', invite_revoke: 'invite taken back', purchase: 'purchase', refund: 'refund',
  admin: 'staff', leave: 'left the server', expire: 'expired',
};
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

function Entries({ rows, showMember }: { rows: Entry[]; showMember?: boolean }) {
  if (!rows.length) return <EmptyState title="Nothing yet" body="Coin movements will show here." />;
  return (
    <Card className="divide-y divide-ink-700/60 overflow-hidden">
      {rows.map(r => (
        <div key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5 text-sm">
          <span className={`w-16 shrink-0 text-right font-mono ${r.delta > 0 ? 'text-good' : 'text-bad'}`}>{r.delta > 0 ? '+' : ''}{r.delta}</span>
          <span className="w-32 shrink-0 text-xs text-mist-400">{KIND[r.kind] ?? r.kind}</span>
          {showMember ? <span className="w-40 shrink-0 truncate text-mist-200">{r.member ?? r.userId}</span> : null}
          <span className="min-w-0 flex-1 truncate text-mist-200">{r.reason ?? ''}{r.actor ? <span className="text-mist-400"> · by {r.actor}</span> : null}</span>
          <span className="shrink-0 text-xs text-mist-400">{when(r.createdAt)}</span>
        </div>
      ))}
    </Card>
  );
}

export default async function EconomyPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const tab = (TABS.some(([k]) => k === sp.tab) ? sp.tab : 'overview') as Tab;
  const canEdit = isDev(await requireSession());
  const overview = await getOverview();
  const online = Boolean(overview);

  return (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Economy</h1>
          <p className="mt-1 text-sm text-mist-400">
            AION Coin — the shop, orders, balances and rules. The same actions as /eco in Discord, with the same log.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {!canEdit ? <Pill tone="neutral">view only — changes need Dev</Pill> : null}
          <Pill tone={!online ? 'bad' : overview!.economy.enabled ? 'good' : 'warn'}>
            {!online ? 'bot offline' : overview!.economy.enabled ? 'live' : 'not launched'}
          </Pill>
        </div>
      </header>

      <nav className="mb-6 flex flex-wrap gap-1 border-b border-ink-700/60">
        {TABS.map(([key, title]) => (
          <Link key={key} href={`/dashboard/economy?tab=${key}`}
            className={`-mb-px rounded-t-lg border-b-2 px-3 py-2 text-sm transition ${tab === key ? 'border-brand-500 text-mist-50' : 'border-transparent text-mist-400 hover:text-mist-200'}`}>
            {title}{key === 'orders' && overview?.pendingOrders ? ` (${overview.pendingOrders})` : ''}
            {key === 'invites' && overview?.heldInvites ? ` (${overview.heldInvites})` : ''}
          </Link>
        ))}
      </nav>

      {!online ? <EmptyState title="The bot is not answering" body="It may be restarting. Nothing here can be read or changed until it is back." /> : null}

      {online && tab === 'overview' ? (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Earned this week" value={String(overview!.mintedWeek)} hint="voice + invites" />
            <Stat label="Spent this week" value={String(overview!.spentWeek)} hint="purchases" />
            <Stat label="In circulation" value={String(overview!.inCirculation)} hint="all balances" />
            <Stat label="Members with coins" value={String(overview!.holders)} />
            <Stat label="Orders waiting" value={String(overview!.pendingOrders)} />
            <Stat label="Held invites" value={String(overview!.heldInvites)} />
          </div>
          <Card className="p-5">
            <SectionTitle sub={overview!.economy.launchedAt
              ? `Launched ${when(overview!.economy.launchedAt)}. Only joins after that moment can earn an invite coin.`
              : 'Not launched yet: nothing is earned or sold. Add products first, then launch when you announce it.'}>
              {overview!.economy.enabled ? 'Running' : 'Paused'}
            </SectionTitle>
            <LaunchToggle enabled={overview!.economy.enabled} canEdit={canEdit} />
          </Card>
        </>
      ) : null}

      {online && tab === 'products' ? await (async () => {
        const products = (await getProducts())?.products ?? [];
        return (
          <>
            <Card className="mb-6 p-5">
              <SectionTitle sub="Monthly stock is the budget: when it is sold out it is sold out until the 1st (Tehran time).">New product</SectionTitle>
              <ProductForm canEdit={canEdit} />
            </Card>
            <SectionTitle sub="Pictures replace the coloured letter on the shop card and the receipt.">Catalogue</SectionTitle>
            {products.length
              ? <Card className="divide-y divide-ink-700/60 overflow-hidden">{products.map(p => <ProductRow key={p.id} product={p} canEdit={canEdit} />)}</Card>
              : <EmptyState title="The shop is empty" body="Add a product above, or run /eco seed in Discord for the suggested catalogue." />}
          </>
        );
      })() : null}

      {online && tab === 'orders' ? await (async () => {
        const status = (STATUS as readonly string[]).includes(sp.status ?? '') ? sp.status! : 'pending';
        const orders = (await getOrders(status))?.orders ?? [];
        return (
          <>
            <div className="mb-4 flex flex-wrap gap-2">
              {STATUS.map(s => (
                <Link key={s} href={`/dashboard/economy?tab=orders&status=${s}`}
                  className={`rounded-full px-3 py-1 text-xs ${status === s ? 'bg-brand-500/20 text-brand-400' : 'bg-ink-800 text-mist-300 hover:bg-ink-700'}`}>{s}</Link>
              ))}
            </div>
            {orders.length ? (
              <Card className="divide-y divide-ink-700/60 overflow-hidden">
                {orders.map(o => (
                  <div key={o.id} className="flex flex-wrap items-start gap-4 px-5 py-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-mist-400">#{o.id}</span>
                        <span className="text-sm font-medium text-mist-50">{o.productName}</span>
                        <Pill tone={TONE[o.status] ?? 'neutral'}>{o.status}</Pill>
                      </div>
                      <div className="mt-0.5 text-xs text-mist-400">
                        {o.price} coin · {o.buyer ?? o.userId} · {when(o.createdAt)}
                        {o.decidedAt ? ` · ${o.status} ${when(o.decidedAt)}${o.decider ? ` by ${o.decider}` : ''}` : ''}
                      </div>
                      {o.note && o.status !== 'pending' ? <div className="mt-1 text-xs text-mist-300">{o.note}</div> : null}
                    </div>
                    {o.status === 'pending' ? <OrderActions id={o.id} canEdit={canEdit} /> : null}
                  </div>
                ))}
              </Card>
            ) : <EmptyState title={`No ${status === 'all' ? '' : status + ' '}orders`} body="Orders appear here and in #orders in Discord." />}
          </>
        );
      })() : null}

      {online && tab === 'members' ? await (async () => {
        const q = (sp.q ?? '').trim();
        const found = q ? (await getMember(q))?.member ?? null : null;
        return (
          <>
            <form className="mb-6 flex gap-2" action="/dashboard/economy">
              <input type="hidden" name="tab" value="members" />
              <input name="q" defaultValue={q} placeholder="Name, @mention or Discord id"
                className="w-full max-w-md rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-mist-50 outline-none focus:border-brand-500" />
              <button className="rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-400">Find</button>
            </form>
            {q && !found ? <EmptyState title="No member found" body="Try their Discord id — names match by part, the first match wins." /> : null}
            {found ? (
              <>
                <Card className="mb-4 p-5">
                  <div className="mb-4 flex flex-wrap items-center gap-3">
                    <span className="text-lg font-semibold text-mist-50">{found.name ?? found.userId}</span>
                    {found.username ? <span className="text-sm text-mist-400">@{found.username}</span> : null}
                    {!found.inServer ? <Pill tone="bad">not in the server</Pill> : null}
                    {found.frozen ? <Pill tone="bad">frozen</Pill> : null}
                  </div>
                  <div className="mb-5 grid gap-4 sm:grid-cols-4">
                    <Stat label="Balance" value={String(found.balance)} />
                    <Stat label="Earned ever" value={String(found.earned)} />
                    <Stat label="Towards next coin" value={`${found.voiceMinutes} min`} />
                    <Stat label="Last in voice" value={found.lastVoiceAt ? when(found.lastVoiceAt) : '—'} />
                  </div>
                  <div className="flex flex-wrap items-end justify-between gap-4">
                    <AdjustForm userId={found.userId} canEdit={canEdit} />
                    <FreezeButton userId={found.userId} frozen={found.frozen} canEdit={canEdit} />
                  </div>
                </Card>
                <SectionTitle sub="The last 40 movements">History</SectionTitle>
                <Entries rows={found.history} />
              </>
            ) : null}
          </>
        );
      })() : null}

      {online && tab === 'invites' ? await (async () => {
        const invites = (await getHeldInvites())?.invites ?? [];
        return invites.length ? (
          <>
            <p className="mb-4 text-sm text-mist-400">The bot did not see which link these members came through and guessed the inviter. Confirm pays the inviter; reject pays nobody.</p>
            <Card className="divide-y divide-ink-700/60 overflow-hidden">
              {invites.map(c => (
                <div key={c.inviteeId} className="flex flex-wrap items-center gap-4 px-5 py-4">
                  <div className="min-w-0 flex-1 text-sm text-mist-200">
                    <span className="font-medium text-mist-50">{c.invitee ?? c.inviteeId}</span> → guessed inviter <span className="font-medium text-mist-50">{c.inviter ?? c.inviterId}</span>
                    <div className="text-xs text-mist-400">joined {when(c.joinedAt)} · verified {when(c.verifiedAt)}</div>
                  </div>
                  <InviteActions inviteeId={c.inviteeId} canEdit={canEdit} />
                </div>
              ))}
            </Card>
          </>
        ) : <EmptyState title="No held invites" body="Every invite so far was seen directly." />;
      })() : null}

      {online && tab === 'rules' ? (
        <Card className="p-5">
          <SectionTitle sub="Saved rules apply from the next minute. Launching and pausing is on the Overview tab.">Earning and losing</SectionTitle>
          <RulesForm economy={overview!.economy} canEdit={canEdit} />
        </Card>
      ) : null}

      {online && tab === 'log' ? await (async () => {
        const entries = (await getLog())?.entries ?? [];
        return (
          <>
            <p className="mb-4 text-sm text-mist-400">Every coin movement except voice minutes, newest first — the same as #economy-log.</p>
            <Entries rows={entries} showMember />
          </>
        );
      })() : null}
    </>
  );
}
