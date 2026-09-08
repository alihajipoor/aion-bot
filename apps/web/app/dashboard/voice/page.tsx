import { getVoice, getRoles, getCategories } from '@/lib/bot';
import { Card, EmptyState, Pill } from '@/components/ui';
import { VoiceActions } from '@/components/VoiceActions';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const SECTIONS = ['public', 'game', 'entertainment'];

export default async function VoicePage() {
  const [data, roleData, catData] = await Promise.all([getVoice(), getRoles(), getCategories()]);
  const rooms = data?.rooms ?? [];
  const total = rooms.reduce((n, r) => n + r.members.length, 0);

  // Every voice channel, for the move target list.
  const voiceChannels = (catData?.categories ?? []).flatMap(c =>
    c.channels.filter(ch => ch.type === 'GuildVoice' || ch.type === 'GuildStageVoice')
      .map(ch => ({ id: ch.id, name: `${c.name.replace(/[^\p{L}\p{N} ]/gu, '').trim().slice(0, 14)} › ${ch.name}` })));

  // Roles the bot can actually assign are the useful ones to offer.
  const roles = (roleData?.roles ?? []).filter(r => r.members < 500).slice(0, 60);

  return (
    <>
      <header className="mb-7 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Live voice</h1>
          <p className="mt-1 text-sm text-mist-400">
            {total ? `${total} in ${rooms.length} room${rooms.length === 1 ? '' : 's'}` : 'Nobody in voice right now'}
            {' · '}move, mute, punish or assign roles without leaving the panel
          </p>
        </div>
        <Pill tone={data ? 'good' : 'bad'}>{data ? 'live' : 'bot offline'}</Pill>
      </header>

      {rooms.length ? (
        <div className="grid gap-4 xl:grid-cols-2">
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
                  <li key={m.id} className="flex items-start gap-3 px-5 py-3">
                    <span className={`mt-2 h-2 w-2 shrink-0 rounded-full ${m.muted ? 'bg-bad' : 'bg-good'}`} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-mist-200">{m.name}</div>
                      <div className="mt-0.5 flex gap-1.5 text-[11px] text-mist-400">
                        {m.muted ? <span>muted</span> : null}
                        {m.deafened ? <span>deafened</span> : null}
                        {m.streaming ? <span>streaming</span> : null}
                        {!m.muted && !m.deafened && !m.streaming ? <span>active</span> : null}
                      </div>
                    </div>
                    <VoiceActions userId={m.id} muted={m.muted}
                      channels={voiceChannels} roles={roles} sections={SECTIONS} />
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
