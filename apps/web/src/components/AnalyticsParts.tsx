'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { RANGES, type RangeDays } from '@/lib/usage-ranges';

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2';

export const dayLabel = (day: string, isId: boolean) =>
  new Date(`${day}T00:00:00+07:00`).toLocaleDateString(isId ? 'id-ID' : 'en-US', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Jakarta',
  });

export function PageHeader({ title, subtitle, days, isId }: { title: string; subtitle: string; days: RangeDays; isId: boolean }) {
  const pathname = usePathname();
  return (
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-neutral-200 pb-5">
      <div>
        <h1 suppressHydrationWarning className="text-2xl md:text-3xl font-heading font-extrabold text-neutral-950 tracking-tight">{title}</h1>
        <p suppressHydrationWarning className="mt-1 text-sm text-neutral-700">{subtitle}</p>
      </div>
      <nav aria-label={isId ? 'Rentang waktu' : 'Time range'} className="inline-flex self-start sm:self-auto rounded-full border border-neutral-300 bg-white p-1">
        {RANGES.map((r) => (
          <Link
            key={r}
            href={`${pathname}?range=${r}d`}
            scroll={false}
            aria-current={r === days ? 'page' : undefined}
            className={`rounded-full px-4 py-1.5 text-sm pointer-coarse:min-h-11 font-semibold transition-colors ${focusRing} ${
              r === days ? 'bg-neutral-950 text-white' : 'text-neutral-700 hover:text-neutral-950 hover:bg-neutral-100'
            }`}
          >
            {isId ? `${r} hari` : `${r} days`}
          </Link>
        ))}
      </nav>
    </div>
  );
}

export function StatTile({ label, value, note }: { label: string; value: string; note?: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-5">
      <div className="text-sm text-neutral-700">{label}</div>
      <div className="mt-2 text-2xl sm:text-3xl font-heading font-bold text-neutral-950 tabular-nums">{value}</div>
      {note && <div className="mt-1 text-xs text-neutral-600">{note}</div>}
    </div>
  );
}

/** Single-series daily bar chart: one ink, per-bar hover tooltip, screen-reader table. */
export function DailyBars({
  title,
  subtitle,
  days,
  format,
  isId,
  emptyText,
}: {
  title: string;
  subtitle: string;
  days: { day: string; value: number }[];
  format: (n: number) => string;
  isId: boolean;
  emptyText: string;
}) {
  const max = Math.max(0, ...days.map((d) => d.value));
  return (
    <section className="rounded-2xl border border-neutral-200 bg-white p-5 sm:p-6 space-y-4">
      <div>
        <h2 className="font-heading font-bold text-base text-neutral-950">{title}</h2>
        <p className="text-xs text-neutral-600">{subtitle}</p>
      </div>
      {max === 0 ? (
        <p className="py-10 text-center text-sm text-neutral-600">{emptyText}</p>
      ) : (
        <>
          <div aria-hidden="true" className={`flex h-40 items-end border-b border-neutral-300 ${days.length > 40 ? 'gap-px' : 'gap-0.5'}`}>
            {days.map((d) => (
              <div key={d.day} className="group relative flex h-full flex-1 items-end justify-center">
                <div
                  className="w-full max-w-6 rounded-t-[3px] bg-neutral-900 group-hover:bg-neutral-500 transition-colors"
                  style={{ height: d.value > 0 ? `max(${(d.value / max) * 100}%, 2px)` : 0 }}
                />
                <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-neutral-950 px-2 py-1 text-[11px] text-white group-hover:block">
                  {dayLabel(d.day, isId)}: {format(d.value)}
                </div>
              </div>
            ))}
          </div>
          <div aria-hidden="true" className="flex justify-between text-[11px] text-neutral-600">
            <span>{dayLabel(days[0]!.day, isId)}</span>
            <span>{isId ? 'Puncak' : 'Peak'}: {format(max)}</span>
            <span>{dayLabel(days[days.length - 1]!.day, isId)}</span>
          </div>
          <table className="sr-only">
            <caption>{title}</caption>
            <tbody>
              {days.map((d) => (
                <tr key={d.day}>
                  <th scope="row">{dayLabel(d.day, isId)}</th>
                  <td>{format(d.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

export function TableCard({ title, children, empty }: { title: string; children: React.ReactNode; empty?: string }) {
  return (
    <section className="rounded-2xl border border-neutral-200 bg-white">
      <h2 className="px-5 sm:px-6 pt-5 pb-3 font-heading font-bold text-base text-neutral-950">{title}</h2>
      {empty ? <p className="px-6 pb-10 pt-4 text-center text-sm text-neutral-600">{empty}</p> : <div className="overflow-x-auto">{children}</div>}
    </section>
  );
}

export const th = 'px-5 sm:px-6 py-3 text-xs font-semibold text-neutral-700 whitespace-nowrap';
export const td = 'px-5 sm:px-6 py-3 whitespace-nowrap tabular-nums';
