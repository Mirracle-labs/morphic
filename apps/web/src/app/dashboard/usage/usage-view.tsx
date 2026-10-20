'use client';

import { useTranslation } from '@/lib/i18n';
import { formatCredits } from '@/lib/utils';
import type { Analytics } from '@/lib/usage-analytics';
import type { RangeDays } from '@/lib/usage-ranges';
import { DailyBars, PageHeader, StatTile, TableCard, td, th } from '@/components/AnalyticsParts';

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 2 });

export function UsageView({ data, days }: { data: Analytics | null; days: RangeDays }) {
  const { locale } = useTranslation();
  const isId = locale === 'id';

  const header = (
    <PageHeader
      title={isId ? 'Penggunaan' : 'Usage'}
      subtitle={isId ? 'Request dan token yang kamu kirim, per hari dan per model.' : 'Requests and tokens you sent, per day and per model.'}
      days={days}
      isId={isId}
    />
  );

  if (!data) {
    return (
      <div className="space-y-6">
        {header}
        <p className="py-16 text-center text-sm text-neutral-700">
          {isId ? 'Data penggunaan tidak bisa dimuat saat ini. Coba muat ulang sebentar lagi.' : 'Usage data could not be loaded right now. Try reloading in a moment.'}
        </p>
      </div>
    );
  }

  const sum = (k: 'requests' | 'errors' | 'promptTokens' | 'completionTokens') => data.daily.reduce((a, d) => a + d[k], 0);
  const requests = sum('requests');
  const errors = sum('errors');
  const prompt = sum('promptTokens');
  const completion = sum('completionTokens');
  const timed = data.byModel.filter((m) => m.avgLatencyMs !== null);
  const timedReq = timed.reduce((a, m) => a + m.requests, 0);
  const avgLatency = timedReq ? timed.reduce((a, m) => a + m.avgLatencyMs! * m.requests, 0) / timedReq : null;
  const pct = (ok: number, all: number) => (all ? `${((ok / all) * 100).toFixed(1)}%` : '—');
  const byRequests = [...data.byModel].sort((a, b) => b.requests - a.requests);
  const noData = isId ? `Belum ada request dalam ${days} hari terakhir.` : `No requests in the last ${days} days.`;

  return (
    <div className="space-y-6">
      {header}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Request" value={formatCredits(requests)} note={isId ? `${days} hari terakhir` : `last ${days} days`} />
        <StatTile
          label="Token"
          value={compact.format(prompt + completion)}
          note={`${isId ? 'Input' : 'Input'} ${compact.format(prompt)} · Output ${compact.format(completion)}`}
        />
        <StatTile
          label={isId ? 'Tingkat sukses' : 'Success rate'}
          value={pct(requests - errors, requests)}
          note={isId ? `${formatCredits(errors)} request gagal` : `${formatCredits(errors)} failed requests`}
        />
        <StatTile
          label={isId ? 'Rata-rata latensi' : 'Average latency'}
          value={avgLatency === null ? '—' : `${(avgLatency / 1000).toFixed(2)} s`}
          note={isId ? 'sampai respons selesai' : 'to full response'}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <DailyBars
          title={isId ? 'Request per hari' : 'Requests per day'}
          subtitle={isId ? 'Waktu WIB' : 'WIB time'}
          days={data.daily.map((d) => ({ day: d.day, value: d.requests }))}
          format={(n) => `${formatCredits(n)} request`}
          isId={isId}
          emptyText={noData}
        />
        <DailyBars
          title={isId ? 'Token per hari' : 'Tokens per day'}
          subtitle={isId ? 'Input + output, waktu WIB' : 'Input + output, WIB time'}
          days={data.daily.map((d) => ({ day: d.day, value: d.promptTokens + d.completionTokens }))}
          format={(n) => `${compact.format(n)} token`}
          isId={isId}
          emptyText={noData}
        />
      </div>

      <TableCard title={isId ? 'Penggunaan per model' : 'Usage by model'} empty={byRequests.length ? undefined : noData}>
        <table className="w-full text-sm text-left">
          <thead className="border-y border-neutral-200 bg-neutral-50">
            <tr>
              <th scope="col" className={th}>Model</th>
              <th scope="col" className={`${th} text-right`}>Request</th>
              <th scope="col" className={`${th} text-right`}>{isId ? 'Token input' : 'Input tokens'}</th>
              <th scope="col" className={`${th} text-right`}>{isId ? 'Token output' : 'Output tokens'}</th>
              <th scope="col" className={`${th} text-right`}>{isId ? 'Sukses' : 'Success'}</th>
              <th scope="col" className={`${th} text-right`}>{isId ? 'Latensi' : 'Latency'}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100 text-neutral-800">
            {byRequests.map((m) => (
              <tr key={m.publicModelId ?? 'unknown'}>
                <td className={td}>
                  <div className="font-semibold text-neutral-950">{m.model ?? (isId ? 'Model dihapus' : 'Deleted model')}</div>
                  {m.publicModelId && <div className="font-mono text-xs text-neutral-600">{m.publicModelId}</div>}
                </td>
                <td className={`${td} text-right font-semibold text-neutral-950`}>{formatCredits(m.requests)}</td>
                <td className={`${td} text-right`}>{compact.format(m.promptTokens)}</td>
                <td className={`${td} text-right`}>{compact.format(m.completionTokens)}</td>
                <td className={`${td} text-right`}>{pct(m.requests - m.errors, m.requests)}</td>
                <td className={`${td} text-right`}>{m.avgLatencyMs === null ? '—' : `${(m.avgLatencyMs / 1000).toFixed(2)} s`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableCard>
    </div>
  );
}
