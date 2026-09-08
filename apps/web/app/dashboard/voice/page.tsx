import { getVoice } from '@/lib/bot';
import { Card, EmptyState, Pill } from '@/components/ui';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function VoicePage() {
  const data = await getVoice();
  const rooms = data?.rooms ?? [];
  const total = rooms.reduce((n, r) => n + r.members.length, 0);

  return (
    <>
      <header className="mb-7 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Live voice</h1>
          <p className="mt-1 text-sm text-mist-400">
            {total ? `${total} in ${rooms.length} room${rooms.length === 1 ? '' : 's'}` : 'Nobody in voice right now'}
          </p>
        </div>
        <span className="text-xs text-mist-400">Refresh the page for the latest</span>
      </header>

      {rooms.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {rooms.map(room => (
            <Card key={room.id} className="overflow-hidden">
              <div className="flex items-center justify-between border-b border-ink-700/60 px-5 py-3.5">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-mist-50">{room.name}</div>
                  {room.parent ? <div className="truncate text-xs text-mist-400">{room.parent}</div> : null}
                </div>
                <Pill>{room.members.length}</Pill>
              </div>
              <ul className="divide-y divide-ink-700/40">
                {room.members.map(m => (
                  <li key={m.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${m.muted ? 'bg-bad' : 'bg-good'}`} />
                    <span className="min-w-0 flex-1 truncate text-mist-200">{m.name}</span>
                    <span className="flex gap-1.5 text-[11px] text-mist-400">
                      {m.muted ? <span title="muted">🔇</span> : null}
                      {m.deafened ? <span title="deafened">🔕</span> : null}
                      {m.streaming ? <span title="streaming">📺</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState title="Voice is empty"
          body={data ? 'Nobody is connected to a voice channel right now.' : 'The bot control API is unreachable.'} />
      )}
    </>
  );
}
