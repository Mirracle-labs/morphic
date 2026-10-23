import test from 'node:test';
import assert from 'node:assert/strict';
import { packagePriceUsdCents, IDR_PER_USD } from '@morphic/shared/credits';
import { centsToPaypalAmount, paypalAmountToCents } from '../lib/paypal.js';

test('P5-3: IDR-priced package conversion to USD cents', () => {
  assert.equal(IDR_PER_USD, 16_000, 'Fixed FX rate must be 16,000 IDR per USD');

  // Rp 160,000 at 16,000/USD = $10.00 = 1000 cents
  const usdCents160k = packagePriceUsdCents(160_000, 'IDR');
  assert.equal(usdCents160k, 1000);
  assert.equal(centsToPaypalAmount(usdCents160k), '10.00');

  // Rp 80,000 at 16,000/USD = $5.00 = 500 cents
  const usdCents80k = packagePriceUsdCents(80_000, 'IDR');
  assert.equal(usdCents80k, 500);
  assert.equal(centsToPaypalAmount(usdCents80k), '5.00');

  // Fallback when currency is null/undefined defaults to IDR conversion
  assert.equal(packagePriceUsdCents(160_000, null), 1000);
  assert.equal(packagePriceUsdCents(160_000, undefined), 1000);
});

test('P5-3: USD-priced package retains exact price without conversion', () => {
  // $25.00 package (2500 cents) remains 2500 cents
  const usdCents = packagePriceUsdCents(2500, 'USD');
  assert.equal(usdCents, 2500);
  assert.equal(centsToPaypalAmount(usdCents), '25.00');
});

test('P5-3: Very cheap IDR package clamps to $1.00 minimum floor', () => {
  // Rp 5,000 at 16,000/USD is ~$0.31 -> must clamp to 100 cents ($1.00)
  const usdCentsCheap = packagePriceUsdCents(5_000, 'IDR');
  assert.equal(usdCentsCheap, 100, 'Floor must be 100 cents ($1.00)');
  assert.equal(centsToPaypalAmount(usdCentsCheap), '1.00');

  // Rp 1,000 -> clamps to 100 cents
  assert.equal(packagePriceUsdCents(1_000, 'IDR'), 100);
});

test('P5-3: centsToPaypalAmount and paypalAmountToCents are strictly reciprocal', () => {
  for (const cents of [100, 500, 1000, 2500, 9999]) {
    const formatted = centsToPaypalAmount(cents);
    const parsed = paypalAmountToCents(formatted);
    assert.equal(parsed, cents, `Mismatch for ${cents} cents (formatted: ${formatted})`);
  }
});
