import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center px-6">
      <div className="text-center">
        <div className="text-sm font-semibold uppercase tracking-[0.3em] text-mist-400">AION</div>
        <h1 className="mt-3 text-2xl font-semibold text-mist-50">That page does not exist</h1>
        <p className="mt-2 text-sm text-mist-400">It may have been renamed, or the link is stale.</p>
        <Link href="/dashboard"
          className="mt-6 inline-block rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-400">
          Back to the panel
        </Link>
      </div>
    </div>
  );
}
