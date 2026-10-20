'use client';

import { formatCredits } from '@/lib/utils';

interface SpendTrendProps {
  /** Oldest first, one entry per WIB day, zero-filled. */
  days: Array<{ day: string; credits: number }>;
  balance: number;
  isId: boolean;
}

/** Days of balance left at the last-7-day average spend; null when nothing was spent. */
function runwayDays(days: Array<{ credits: number }>, balance: number): number | null {
  const last7 = days.slice(-7);
  const avg = last7.reduce((sum, d) => sum + d.credits, 0) / Math.max(1, last7.length);
  return avg > 0 ? Math.floor(balance / avg) : null;
}

export function SpendTrend({ days, balance, isId }: SpendTrendProps) {
  const max = Math.max(0, ...days.map((d) => d.credits));
  const runway = runwayDays(days, balance);
  const label = (day: string) =>
    new Date(`${day}T00:00:00+07:00`).toLocaleDateString(isId ? 'id-ID' : 'en-US', {
      day: 'numeric',
      month: 'short',
      timeZone: 'Asia/Jakarta',
    });

  return (
    <section
      aria-labelledby="spend-trend-title"
      className="p-6 rounded-2xl bg-white border border-neutral-200 space-y-4"
    >
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
        <div>
          <h2 id="spend-trend-title" className="font-heading font-bold text-base text-neutral-950">
            {isId ? 'Pemakaian kredit 14 hari terakhir' : 'Credits spent, last 14 days'}
          </h2>
          <p className="text-xs text-neutral-600">{isId ? 'Per hari, waktu WIB' : 'Per day, WIB time'}</p>
        </div>
        <p className="text-xs text-neutral-700 sm:text-right max-w-xs">
          {runway === null
            ? isId
              ? 'Belum ada pemakaian 7 hari terakhir, jadi sisa hari saldo belum bisa diperkirakan.'
              : 'No spend in the last 7 days, so there is no runway estimate yet.'
            : isId
              ? <>Dengan rata-rata 7 hari terakhir, saldo cukup untuk <strong className="text-neutral-950">~{runway.toLocaleString('id-ID')} hari</strong> lagi.</>
              : <>At the last 7-day average, your balance lasts <strong className="text-neutral-950">~{runway.toLocaleString('en-US')} more days</strong>.</>}
        </p>
      </div>

      {days.length === 0 ? (
        <p className="py-8 text-center text-xs text-neutral-600">
          {isId ? 'Data pemakaian tidak bisa dimuat saat ini.' : 'Usage data could not be loaded right now.'}
        </p>
      ) : max === 0 ? (
        <p className="py-8 text-center text-xs text-neutral-600">
          {isId ? 'Belum ada pemakaian dalam 14 hari terakhir.' : 'No usage in the last 14 days.'}
        </p>
      ) : (
        <>
          {/* Bars are the only encoding (one series, one ink); exact values live in each bar's
              tooltip and in the screen-reader table below. */}
          <div aria-hidden="true" className="flex h-36 items-end gap-0.5 border-b border-neutral-200">
            {days.map((d) => (
              <div key={d.day} className="group relative flex h-full flex-1 items-end justify-center">
                <div
                  className="w-full max-w-5 rounded-t bg-neutral-900 group-hover:bg-neutral-600 transition-colors"
                  style={{ height: d.credits > 0 ? `max(${(d.credits / max) * 100}%, 2px)` : 0 }}
                />
                <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded-lg bg-neutral-950 px-2 py-1 text-[11px] text-white group-hover:block">
                  {label(d.day)}: {formatCredits(d.credits)}
                </div>
              </div>
            ))}
          </div>
          <div aria-hidden="true" className="flex justify-between text-[11px] text-neutral-600">
            <span>{label(days[0].day)}</span>
            <span>{label(days[days.length - 1].day)}</span>
          </div>
          <table className="sr-only">
            <caption>{isId ? 'Kredit per hari' : 'Credits per day'}</caption>
            <tbody>
              {days.map((d) => (
                <tr key={d.day}>
                  <th scope="row">{label(d.day)}</th>
                  <td>{formatCredits(d.credits)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
