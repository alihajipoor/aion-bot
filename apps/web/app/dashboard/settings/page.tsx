import { getSettings } from '@/lib/bot';
import { SettingsForm } from '@/components/SettingsForm';
import { EmptyState } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const data = await getSettings();

  return (
    <>
      <header className="mb-7">
        <h1 className="text-2xl font-semibold tracking-tight">Bot settings</h1>
        <p className="mt-1 text-sm text-mist-400">
          Everything here is read live by the bot. Changes apply within 30 seconds, no restart.
        </p>
      </header>
      {data
        ? <SettingsForm settings={data.settings} />
        : <EmptyState title="Bot unreachable" body="Settings cannot be loaded while the control API is down." />}
    </>
  );
}
