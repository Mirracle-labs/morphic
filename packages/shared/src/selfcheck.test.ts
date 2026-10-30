import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateApiKey, hashApiKey, displayPrefix, KEY_PREFIX } from './keys.ts';
import {
  estimateReservation,
  actualUsageCredits,
  reserveOutputCap,
  tokensToCredits,
  costCreditsPer1m,
  sellCreditsPer1m,
  multiplier,
  passPricing,
  BALANCE_CREDITS_PER_IDR,
  IDR_PER_1M_BASE_TOKENS,
} from './credits.ts';

test('api key generation and hashing', () => {
  const k = generateApiKey();
  assert.ok(k.raw.startsWith(KEY_PREFIX));
  assert.equal(k.hash, hashApiKey(k.raw));
  assert.equal(k.prefix, displayPrefix(k.raw));
  assert.notEqual(hashApiKey(k.raw), hashApiKey('mp-other'));
});

test('reserve output cap clamps to hard cap and context', () => {
  const base = {
    promptTokens: 100,
    modelContextLength: 32768,
    hardReserveCap: 16384,
    pricing: { inputCreditsPer1m: 100, outputCreditsPer1m: 200 },
  };
  assert.equal(reserveOutputCap({ ...base, requestedMaxTokens: 999_999 }), 16384);
  assert.equal(reserveOutputCap({ ...base, requestedMaxTokens: null }), 16384);
  assert.equal(reserveOutputCap({ ...base, requestedMaxTokens: 500 }), 500);
  assert.equal(
    reserveOutputCap({ ...base, modelContextLength: 1000, requestedMaxTokens: null }),
    1000,
  );
});

test('reservation estimate is ceiling, actual usage <= estimate', () => {
  const input = {
    promptTokens: 1000,
    requestedMaxTokens: 2000,
    modelContextLength: 32768,
    hardReserveCap: 16384,
    pricing: { inputCreditsPer1m: 100, outputCreditsPer1m: 200 },
  };
  const est = estimateReservation(input);
  assert.equal(est, tokensToCredits(1000, 100) + tokensToCredits(2000, 200));
  const actual = actualUsageCredits(1000, 500, input.pricing);
  assert.ok(actual <= est);
});

test('credits round up, never negative', () => {
  assert.equal(tokensToCredits(1, 100), 1);
  assert.equal(tokensToCredits(0, 100), 0);
});

test('sendEmail without RESEND_API_KEY logs in dev and throws in production', async () => {
  const { sendEmail } = await import('./email.ts');
  const prevKey = process.env.RESEND_API_KEY;
  const prevEnv = process.env.NODE_ENV;
  delete process.env.RESEND_API_KEY;
  const msg = { to: 'a@b.c', subject: 's', html: '<p>x</p>', text: 'x' };
  try {
    process.env.NODE_ENV = 'development';
    await sendEmail(msg);
    process.env.NODE_ENV = 'production';
    await assert.rejects(sendEmail(msg), /RESEND_API_KEY/);
  } finally {
    process.env.NODE_ENV = prevEnv;
    if (prevKey) process.env.RESEND_API_KEY = prevKey;
  }
});

test('tokenomics: 1x = Rp 400/1M, markup 30%, floor 1x', () => {
  // 10M tokens at 1x cost exactly the Rp 4.000 token pack.
  assert.equal((10 * IDR_PER_1M_BASE_TOKENS), 4_000);
  // Claude Sonnet output $10/1M at Rp 18.100/USD = Rp 181.000 = 452.5x at cost, 588.25x sold.
  assert.equal(multiplier(costCreditsPer1m(10)), 452.5);
  assert.equal(multiplier(sellCreditsPer1m(costCreditsPer1m(10))), 588.25);
  // Free upstream still bills 1x.
  assert.equal(sellCreditsPer1m(costCreditsPer1m(0)), 1_000_000);
  // 1,000 output tokens on that model burn 588,250 credits.
  assert.equal(tokensToCredits(1_000, sellCreditsPer1m(costCreditsPer1m(10))), 588_250);
  // Balance is dearer than packs: Rp 4.000 of balance buys 8M, not 10M.
  assert.equal(4_000 * BALANCE_CREDITS_PER_IDR, 8_000_000);
});

test('unlimited passes meter input-equivalent tokens', () => {
  // Equal prices (DeepSeek Local): raw tokens, unchanged.
  assert.deepEqual(passPricing({ inputCreditsPer1m: 1_000_000, outputCreditsPer1m: 1_000_000 }), { inputCreditsPer1m: 1_000_000, outputCreditsPer1m: 1_000_000 });
  // GLM 5.3 Flash sells 8.84x in / 31.2x out: one output token uses ~3.53 tokens of the cap.
  const glm = passPricing({ inputCreditsPer1m: 8_840_000, outputCreditsPer1m: 31_200_000 });
  assert.equal(glm.inputCreditsPer1m, 1_000_000);
  assert.equal(glm.outputCreditsPer1m, 3_529_412);
  // Output cheaper than input never discounts the cap below raw tokens.
  assert.equal(passPricing({ inputCreditsPer1m: 4_000_000, outputCreditsPer1m: 2_000_000 }).outputCreditsPer1m, 1_000_000);
});
