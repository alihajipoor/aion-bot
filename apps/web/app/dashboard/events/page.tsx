import { getEvents } from '@/lib/bot';
import { Card, EmptyState, Pill, SectionTitle } from '@/components/ui';
import { EventRow, NewEvent } from '@/components/EventControls';
import { AutoRefresh } from '@/components/AutoRefresh';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const GAME: Record<string, { emoji: string; label: string }> = {
  mafia: { emoji: '🕵️', label: 'Mafia' },
  esmfamil: { emoji: '✍️', label: 'Esm Famil' },
  bistsoali: { emoji: '❓', label: '20 Soali' },
  custom: { emoji: '🎪', label: 'Custom' },
};

const TONE: Record<string, 'neutral' | 'good' | 'warn' | 'bad'> = {
  draft: 'neutral', announced: 'warn', running: 'good', ended: 'neutral', cancelled: 'bad',
};

export default async function EventsPage() {
  const data = await getEvents();
  const live = data?.live ?? [];
  const past = data?.past ?? [];

  return (
    <>
      <header className="mb-7 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Events</h1>
          <p className="mt-1 text-sm text-mist-400">
            The same lifecycle the Discord console drives — create, announce, start, end.
            Game settings live in Bot settings.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <AutoRefresh seconds={15} />
          <Pill tone={data ? 'good' : 'bad'}>{data ? 'bot online' : 'bot offline'}</Pill>
        </div>
      </header>

      <Card className="mb-6 p-5">
        <SectionTitle sub="It starts as a draft; nothing is public until you announce it.">New event</SectionTitle>
        <NewEvent />
      </Card>

      <SectionTitle sub="Drafts, announced and running">Active</SectionTitle>
      {live.length ? (
        <Card className="mb-8 divide-y divide-ink-700/60 overflow-hidden">
          {live.map(e => {
            const g = GAME[e.game] ?? GAME.custom!;
            return (
              <div key={e.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                <span className="text-xl">{g.emoji}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-mist-50">{e.title}</span>
                    <Pill tone={TONE[e.status] ?? 'neutral'}>{e.status}</Pill>
                  </div>
                  <div className="mt-0.5 truncate text-xs text-mist-400">
                    {g.label} · host {e.hostTag ?? e.hostId} · {e.players.length}
                    {e.capacity ? `/${e.capacity}` : ''} signed up
                    {e.scheduledFor ? ` · starts ${new Date(e.scheduledFor).toLocaleString('en-GB')}` : ''}
                  </div>
                </div>
                <EventRow id={e.id} status={e.status} />
              </div>
            );
          })}
        </Card>
      ) : (
        <div className="mb-8">
          <EmptyState title="Nothing running" body="Create a draft above, or use the console in EVENT-INTERFACE." />
        </div>
      )}

      <SectionTitle sub="Ended and cancelled">History</SectionTitle>
      {past.length ? (
        <Card className="divide-y divide-ink-700/60 overflow-hidden">
          {past.map(e => (
            <div key={e.id} className="flex items-center gap-4 px-5 py-3">
              <span>{(GAME[e.game] ?? GAME.custom!).emoji}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-mist-200">{e.title}</div>
                <div className="text-xs text-mist-400">
                  {e.playerCount} players
                  {e.endedAt ? ` · ${new Date(e.endedAt).toLocaleDateString('en-GB')}` : ''}
                </div>
              </div>
              <Pill tone={TONE[e.status] ?? 'neutral'}>{e.status}</Pill>
              <EventRow id={e.id} status={e.status} />
            </div>
          ))}
        </Card>
      ) : (
        <EmptyState title="No history yet" body="Finished events are listed here with their attendance." />
      )}
    </>
  );
}
