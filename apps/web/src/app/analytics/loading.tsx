// Shown instantly while the analytics rollup loads.
export default function AnalyticsLoading() {
  const block = 'rounded-2xl bg-neutral-200/70 motion-safe:animate-pulse';
  return (
    <div className="min-h-screen bg-[#fafafa] px-4 sm:px-6 pt-28 sm:pt-32" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="mx-auto max-w-6xl space-y-6">
        <div className={`${block} h-12 w-80 max-w-full`} />
        <div className={`${block} h-32`} />
        <div className={`${block} h-96`} />
        <div className={`${block} h-96`} />
      </div>
    </div>
  );
}
