import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buckets, periodWindow, rank, spark } from './analytics-math.ts';

const row = (day: string, key: string, tokens: number) => ({ day, key, tokens, requests: 1, credits: tokens / 10, errors: 0, latencyMs: 0, latencyN: 0 });
const today = '2026-10-21'; // a Wednesday
const rows = [row('2026-10-21', 'a', 100), row('2026-10-20', 'a', 50), row('2026-10-19', 'a', 25), row('2026-10-20', 'b', 200), row('2026-10-12', 'b', 100)];

test('periodWindow: yesterday is one full day, 7d has a previous week', () => {
  assert.deepEqual(periodWindow('1d', today), { from: '2026-10-20', to: '2026-10-20', prevFrom: '2026-10-19', prevTo: '2026-10-19' });
  assert.deepEqual(periodWindow('7d', today), { from: '2026-10-15', to: '2026-10-21', prevFrom: '2026-10-08', prevTo: '2026-10-14' });
});

test('rank: sorted with change vs previous window, regrouped by keyOf', () => {
  assert.deepEqual(rank(rows, 'tokens', '1d', today), [{ key: 'b', value: 200, change: null }, { key: 'a', value: 50, change: 100 }]);
  assert.deepEqual(rank(rows, 'tokens', '7d', today), [{ key: 'a', value: 175, change: null }, { key: 'b', value: 200, change: 100 }].sort((x, y) => y.value - x.value));
  assert.deepEqual(rank(rows, 'tokens', 'all', today, () => 'g'), [{ key: 'g', value: 475, change: null }]);
});

test('buckets: zero-filled days, weeks start Monday', () => {
  const d = buckets(rows, 'tokens', 'daily', today);
  assert.equal(d.length, 30);
  assert.equal(d.at(-1)!.total, 100);
  assert.equal(d.at(-2)!.byKey.get('b'), 200);
  const w = buckets(rows, 'tokens', 'weekly', today);
  assert.equal(w.at(-1)!.start, '2026-10-19');
  assert.equal(w.at(-1)!.total, 375);
  assert.equal(w.at(-2)!.total, 100);
  assert.deepEqual(spark(rows, 'a', 'tokens', today, 3), [25, 50, 100]);
});
