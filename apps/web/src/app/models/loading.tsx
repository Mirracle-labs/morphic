// Shown instantly while the catalog's server data loads.
export default function ModelsLoading() {
  const block = 'rounded-2xl bg-neutral-200/70 motion-safe:animate-pulse';
  return (
    <div className="min-h-screen bg-[#fafafa] px-4 sm:px-6 pt-28 sm:pt-36" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="mx-auto max-w-7xl space-y-6">
        <div className={`${block} h-4 w-32`} />
        <div className={`${block} h-12 w-96 max-w-full`} />
        <div className={`${block} h-10 w-80 max-w-full rounded-full`} />
        <div className="flex gap-6">
          <div className={`${block} hidden lg:block h-96 w-64 shrink-0`} />
          <div className="grid flex-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className={`${block} h-72`} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
