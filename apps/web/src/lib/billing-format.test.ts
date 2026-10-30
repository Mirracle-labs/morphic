import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtMultiplier } from './billing-format.ts';

test('fmtMultiplier keeps sub-0.1x prices visible instead of rounding them to 0x', () => {
  assert.equal(fmtMultiplier(100, true), '0.0001x');
  assert.equal(fmtMultiplier(1_300_000, true), '1.3x');
  assert.equal(fmtMultiplier(15_600_000, true), '16x');
  assert.equal(fmtMultiplier(5_200_000), '5,2x');
  assert.equal(fmtMultiplier(0, true), '0x');
});
