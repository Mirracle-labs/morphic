// Client-safe rollups for the public /analytics pages. Days are WIB YYYY-MM-DD strings.
import type { DayRow } from './public-analytics';

export type Metric = 'tokens' | 'requests' | 'credits';
export type Period = '1d' | '7d' | '30d' | 'all';
export type Grain = 'daily' | 'weekly';

export const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Inclusive [from, to] for a period ending today, and the equally long window before it. Yesterday is a full day. */
export function periodWindow(period: Period, today: string): { from: string; to: string; prevFrom: string | null; prevTo: string | null } {
  if (period === 'all') return { from: '0000-00-00', to: today, prevFrom: null, prevTo: null };
  if (period === '1d') return { from: addDays(today, -1), to: addDays(today, -1), prevFrom: addDays(today, -2), prevTo: addDays(today, -2) };
  const n = period === '7d' ? 7 : 30;
  return { from: addDays(today, -(n - 1)), to: today, prevFrom: addDays(today, -(2 * n - 1)), prevTo: addDays(today, -n) };
}

const sumBy = (rows: DayRow[], metric: Metric, from: string, to: string, keyOf: (k: string) => string) => {
  const out = new Map<string, number>();
  for (const r of rows) if (r.day >= from && r.day <= to) out.set(keyOf(r.key), (out.get(keyOf(r.key)) ?? 0) + r[metric]);
  return out;
};

export interface Ranked {
  key: string;
  value: number;
  /** Percent change vs the previous window; null when there is no previous window or it was zero. */
  change: number | null;
}

/** Keys ranked by metric over the period, largest first. `keyOf` regroups keys (e.g. model → maker). */
export function rank(rows: DayRow[], metric: Metric, period: Period, today: string, keyOf: (k: string) => string = (k) => k): Ranked[] {
  const w = periodWindow(period, today);
  const cur = sumBy(rows, metric, w.from, w.to, keyOf);
  const prev = w.prevFrom ? sumBy(rows, metric, w.prevFrom, w.prevTo!, keyOf) : new Map<string, number>();
  return [...cur]
    .filter(([, v]) => v > 0)
    .map(([key, value]) => {
      const p = prev.get(key) ?? 0;
      return { key, value, change: w.prevFrom && p > 0 ? ((value - p) / p) * 100 : null };
    })
    .sort((a, b) => b.value - a.value);
}

/** Keeps the top `n` and folds the rest into one "others" entry. */
export function topWithOthers(list: Ranked[], n: number): { top: Ranked[]; others: number } {
  return { top: list.slice(0, n), others: list.slice(n).reduce((a, r) => a + r.value, 0) };
}

export interface Bucket {
  /** First day of the bucket. */
  start: string;
  total: number;
  byKey: Map<string, number>;
}

/** Zero-filled buckets ending today: the last 30 days, or the last 26 weeks starting on Mondays. */
export function buckets(rows: DayRow[], metric: Metric, grain: Grain, today: string): Bucket[] {
  const weekStart = (d: string) => addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7));
  const startOf = grain === 'daily' ? (d: string) => d : weekStart;
  const count = grain === 'daily' ? 30 : 26;
  const last = startOf(today);
  const step = grain === 'daily' ? 1 : 7;
  const list: Bucket[] = Array.from({ length: count }, (_, i) => ({ start: addDays(last, -(count - 1 - i) * step), total: 0, byKey: new Map() }));
  const at = new Map(list.map((b) => [b.start, b]));
  for (const r of rows) {
    const b = at.get(startOf(r.day));
    if (!b) continue;
    b.total += r[metric];
    b.byKey.set(r.key, (b.byKey.get(r.key) ?? 0) + r[metric]);
  }
  return list;
}

/** Daily values of one key over the last `days` days, oldest first. */
export function spark(rows: DayRow[], key: string, metric: Metric, today: string, days = 14): number[] {
  const from = addDays(today, -(days - 1));
  const out = new Array<number>(days).fill(0);
  for (const r of rows) {
    if (r.key !== key || r.day < from || r.day > today) continue;
    out[(Date.parse(r.day) - Date.parse(from)) / 86_400_000] += r[metric];
  }
  return out;
}
