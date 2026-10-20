// Shown instantly on navigation while the page's server data loads, so a click never feels stuck.
export default function DashboardLoading() {
  const block = 'rounded-2xl bg-neutral-100 motion-safe:animate-pulse';
  return (
    <div className="w-full space-y-10" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="space-y-3 border-b border-neutral-200 pb-6">
        <div className={`${block} h-10 w-64`} />
        <div className={`${block} h-4 w-80 max-w-full`} />
      </div>
      <div className="space-y-4">
        <div className={`${block} h-6 w-40`} />
        <div className="grid gap-4 md:grid-cols-3">
          <div className={`${block} h-36`} />
          <div className={`${block} h-36`} />
          <div className={`${block} h-36`} />
        </div>
      </div>
      <div className={`${block} h-72`} />
    </div>
  );
}
