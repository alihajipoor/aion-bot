import { getCategories } from '@/lib/bot';
import { Card, EmptyState } from '@/components/ui';

export const dynamic = 'force-dynamic';

const ICON: Record<string, string> = {
  GuildText: '#', GuildVoice: '🔊', GuildAnnouncement: '📢',
  GuildForum: '💬', GuildStageVoice: '🎙', GuildMedia: '🖼',
};

export default async function StructurePage() {
  const data = await getCategories();
  const cats = data?.categories ?? [];
  const channelCount = cats.reduce((n, c) => n + c.channels.length, 0);

  return (
    <>
      <header className="mb-7">
        <h1 className="text-2xl font-semibold tracking-tight">Structure</h1>
        <p className="mt-1 text-sm text-mist-400">
          {cats.length ? `${cats.length} categories · ${channelCount} channels` : 'Server layout'}
        </p>
      </header>

      {cats.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {cats.map(cat => (
            <Card key={cat.id} className="overflow-hidden">
              <div className="border-b border-ink-700/60 px-5 py-3">
                <div className="truncate text-xs font-semibold uppercase tracking-[0.14em] text-mist-400">
                  {cat.name}
                </div>
              </div>
              <ul className="px-2 py-2">
                {cat.channels.length ? cat.channels.map(ch => (
                  <li key={ch.id} className="flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm
                                              text-mist-300 transition hover:bg-ink-800/60">
                    <span className="w-4 shrink-0 text-center text-xs text-mist-400">
                      {ICON[ch.type] ?? '·'}
                    </span>
                    <span className="min-w-0 truncate">{ch.name}</span>
                  </li>
                )) : (
                  <li className="px-3 py-2 text-sm text-mist-400/70">empty</li>
                )}
              </ul>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState title="No structure to show" body="The bot control API is unreachable." />
      )}
    </>
  );
}
