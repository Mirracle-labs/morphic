// Shown instantly while the model's stats load.
export default function ModelLoading() {
  const block = 'rounded-2xl bg-neutral-200/70 motion-safe:animate-pulse';
  return (
    <div className="min-h-screen bg-[#fafafa] px-4 sm:px-6 pt-28 sm:pt-32" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>
      <div className="mx-auto max-w-6xl space-y-6">
        <div className={`${block} h-4 w-28`} />
        <div className={`${block} h-60`} />
        <div className={`${block} h-44`} />
        <div className={`${block} h-48`} />
      </div>
    </div>
  );
}
