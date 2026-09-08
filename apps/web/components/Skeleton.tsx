/** Shapes that match what is loading, so the page does not jump when it lands. */
export function Line({ w = 'w-full' }: { w?: string }) {
  return <div className={`h-3 rounded bg-ink-700/60 ${w}`} />;
}

export function SkeletonCard({ rows = 3 }: { rows?: number }) {
  return (
    <div className="rounded-2xl border border-ink-700/70 bg-ink-850/70 p-5">
      <div className="space-y-3">
        <Line w="w-1/3" />
        {Array.from({ length: rows }, (_, i) => <Line key={i} w={i % 2 ? 'w-4/5' : 'w-full'} />)}
      </div>
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="animate-pulse" aria-hidden>
      <div className="mb-7 space-y-2">
        <div className="h-7 w-52 rounded bg-ink-700/60" />
        <Line w="w-80" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => <SkeletonCard key={i} rows={1} />)}
      </div>
      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        <SkeletonCard rows={5} />
        <SkeletonCard rows={5} />
      </div>
    </div>
  );
}
