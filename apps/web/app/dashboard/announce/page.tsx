import { getChannels, getRoles } from '@/lib/bot';
import { AnnounceForm } from '@/components/AnnounceForm';
import { Card, EmptyState } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function AnnouncePage() {
  const [chans, roles] = await Promise.all([getChannels(), getRoles()]);

  if (!chans || !roles) {
    return (
      <>
        <header className="mb-7">
          <h1 className="text-2xl font-semibold tracking-tight">Announcements</h1>
        </header>
        <EmptyState title="Bot unreachable"
          body="The control API is not responding, so channels and roles cannot be listed. Try again once the bot is back." />
      </>
    );
  }

  return (
    <>
      <header className="mb-7">
        <h1 className="text-2xl font-semibold tracking-tight">Announcements</h1>
        <p className="mt-1 text-sm text-mist-400">Post to any channel as AION. Every send is recorded in the audit log.</p>
      </header>
      <Card className="p-6">
        <AnnounceForm channels={chans.channels} roles={roles.roles} />
      </Card>
    </>
  );
}
