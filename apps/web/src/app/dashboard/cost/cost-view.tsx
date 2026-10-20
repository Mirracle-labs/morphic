'use client';

import { useTranslation } from '@/lib/i18n';
import { formatCredits } from '@/lib/utils';
import type { Analytics } from '@/lib/usage-analytics';
import type { RangeDays } from '@/lib/usage-ranges';
import { DailyBars, PageHeader, StatTile, TableCard, td, th } from '@/components/AnalyticsParts';

export function CostView({ data, days }: { data: Analytics | null; days: RangeDays }) {
  const { locale } = useTranslation();
  const isId = locale === 'id';
  const credits = (n: number) => `${formatCredits(Math.round(n))} ${isId ? 'kredit' : 'credits'}`;

  const header = (
    <PageHeader
      title={isId ? 'Biaya' : 'Cost'}
      subtitle={isId ? 'Kredit yang terpakai, per hari dan per model.' : 'Credits spent, per day and per model.'}
      days={days}
      isId={isId}
    />
  );

  if (!data) {
    return (
      <div className="space-y-6">
        {header}
        <p className="py-16 text-center text-sm text-neutral-700">
          {isId ? 'Data biaya tidak bisa dimuat saat ini. Coba muat ulang sebentar lagi.' : 'Cost data could not be loaded right now. Try reloading in a moment.'}
        </p>
      </div>
    );
  }

  const total = data.daily.reduce((a, d) => a + d.credits, 0);
  const requests = data.daily.reduce((a, d) => a + d.requests, 0);
  const delta = data.prevCredits > 0 ? ((total - data.prevCredits) / data.prevCredits) * 100 : null;

  return (
    <div className="space-y-6">
      {header}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile
          label={isId ? `Total ${days} hari` : `Total, ${days} days`}
          value={formatCredits(total)}
          note={
            delta === null
              ? isId ? `Tidak ada pemakaian di ${days} hari sebelumnya.` : `No spend in the previous ${days} days.`
              : isId
                ? `${delta >= 0 ? '+' : ''}${delta.toFixed(0)}% dibanding ${days} hari sebelumnya`
                : `${delta >= 0 ? '+' : ''}${delta.toFixed(0)}% vs the previous ${days} days`
          }
        />
        <StatTile label={isId ? 'Rata-rata per hari' : 'Average per day'} value={formatCredits(Math.round(total / days))} note={isId ? 'kredit' : 'credits'} />
        <StatTile
          label={isId ? 'Rata-rata per request' : 'Average per request'}
          value={requests ? formatCredits(Math.round(total / requests)) : '—'}
          note={isId ? `dari ${formatCredits(requests)} request` : `across ${formatCredits(requests)} requests`}
        />
      </div>

      <DailyBars
        title={isId ? 'Kredit terpakai per hari' : 'Credits spent per day'}
        subtitle={isId ? 'Waktu WIB' : 'WIB time'}
        days={data.daily.map((d) => ({ day: d.day, value: d.credits }))}
        format={credits}
        isId={isId}
        emptyText={isId ? `Belum ada pemakaian dalam ${days} hari terakhir.` : `No spend in the last ${days} days.`}
      />

      <TableCard
        title={isId ? 'Biaya per model' : 'Cost by model'}
        empty={data.byModel.length ? undefined : isId ? 'Belum ada pemakaian di rentang ini.' : 'No usage in this range.'}
      >
        <table className="w-full text-sm text-left">
          <thead className="border-y border-neutral-200 bg-neutral-50">
            <tr>
              <th scope="col" className={th}>Model</th>
              <th scope="col" className={`${th} text-right`}>{isId ? 'Kredit' : 'Credits'}</th>
              <th scope="col" className={th}>{isId ? 'Porsi' : 'Share'}</th>
              <th scope="col" className={`${th} text-right`}>Request</th>
              <th scope="col" className={`${th} text-right`}>{isId ? 'Rata-rata / request' : 'Avg / request'}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 text-neutral-800">
            {data.byModel.map((m) => {
              const share = total ? (m.credits / total) * 100 : 0;
              return (
                <tr key={m.publicModelId ?? 'unknown'}>
                  <td className={td}>
                    <div className="font-semibold text-neutral-950">{m.model ?? (isId ? 'Model dihapus' : 'Deleted model')}</div>
                    {m.publicModelId && <div className="font-mono text-xs text-neutral-600">{m.publicModelId}</div>}
                  </td>
                  <td className={`${td} text-right font-semibold text-neutral-950`}>{formatCredits(m.credits)}</td>
                  <td className={td}>
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-24 rounded-full bg-neutral-200" aria-hidden="true">
                        <div className="h-full rounded-full bg-neutral-900" style={{ width: `${share}%` }} />
                      </div>
                      <span>{share.toFixed(1)}%</span>
                    </div>
                  </td>
                  <td className={`${td} text-right`}>{formatCredits(m.requests)}</td>
                  <td className={`${td} text-right`}>{m.requests ? formatCredits(Math.round(m.credits / m.requests)) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableCard>
    </div>
  );
}
