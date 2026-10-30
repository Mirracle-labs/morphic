export interface ModelPricing {
  inputCreditsPer1m: number;
  outputCreditsPer1m: number;
}

export interface ReservationInput {
  promptTokens: number;
  requestedMaxTokens: number | null;
  modelContextLength: number;
  hardReserveCap: number;
  pricing: ModelPricing;
}

export function estimatePromptTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function tokensToCredits(tokens: number, creditsPer1m: number): number {
  return Math.ceil((tokens * creditsPer1m) / 1_000_000);
}

export function reserveOutputCap(input: ReservationInput): number {
  const cap = Math.min(
    input.requestedMaxTokens ?? input.modelContextLength,
    input.modelContextLength,
    input.hardReserveCap,
  );
  return Math.max(cap, 0);
}

export function estimateReservation(input: ReservationInput): number {
  const inputCredits = tokensToCredits(input.promptTokens, input.pricing.inputCreditsPer1m);
  const outputCredits = tokensToCredits(
    reserveOutputCap(input),
    input.pricing.outputCreditsPer1m,
  );
  return inputCredits + outputCredits;
}

export function actualUsageCredits(
  promptTokens: number,
  completionTokens: number,
  pricing: ModelPricing,
): number {
  return (
    tokensToCredits(promptTokens, pricing.inputCreditsPer1m) +
    tokensToCredits(completionTokens, pricing.outputCreditsPer1m)
  );
}

/**
 * Checkout FX rate. Single source for the API (what users are charged) and the web
 * (what checkout shows and admin reports convert with). Owner reviews it monthly (OWN-04).
 * ponytail: fixed rate; switch to a cached live rate with sanity bounds if FX moves too fast.
 */
export const IDR_PER_USD = 18_100;

// ── Tokenomics ────────────────────────────────────────
// 1 credit = 1 base token (1x). A model's price is credits per 1M tokens, so its multiplier is
// price / 1M: a 1M-token Claude reply at 520x burns 520M credits.

/** Token-pack rate that defines 1x: 10M tokens = Rp 4.000. */
export const IDR_PER_1M_BASE_TOKENS = 400;
/** Pay-as-you-go balance top-up: Rp 1 buys this many credits (Rp 500/1M, dearer than packs). */
export const BALANCE_CREDITS_PER_IDR = 2_000;
/** Sell price over upstream cost. */
export const PRICE_MARKUP = 1.3;
/** Token packs expire this long after purchase unless the package sets its own duration. */
export const TOKEN_PACK_HOURS = 24 * 30;
/** Unlimited passes only for models whose output multiplier stays at or under this. */
export const UNLIMITED_MAX_OUTPUT_MULTIPLIER = 80;
/** Unlimited passes bill raw tokens against their fair-use cap: no multiplier. */
export const RAW_TOKEN_PRICING: ModelPricing = { inputCreditsPer1m: 1_000_000, outputCreditsPer1m: 1_000_000 };

export const multiplier = (creditsPer1m: number) => creditsPer1m / 1_000_000;

/** Upstream USD per 1M tokens → credits per 1M at cost (no markup). */
export const costCreditsPer1m = (usdPer1m: number) => Math.ceil((usdPer1m * IDR_PER_USD * 1_000_000) / IDR_PER_1M_BASE_TOKENS);

/** Sell price from upstream cost (credits per 1M), never below 1x. */
export const sellCreditsPer1m = (costPer1m: number) => Math.max(1_000_000, Math.ceil(costPer1m * PRICE_MARKUP));

/** Package price in Rupiah (`priceCents` holds whole Rupiah for IDR, cents for USD). */
export function packagePriceIdr(priceCents: number, currency: string | null | undefined): number {
  return currency === 'IDR' || !currency ? priceCents : Math.round((priceCents / 100) * IDR_PER_USD);
}

/** Package price in USD cents, never below PayPal's $1.00 floor for converted IDR packages. */
export function packagePriceUsdCents(priceCents: number, currency: string | null | undefined): number {
  return currency === 'USD' ? priceCents : Math.max(100, Math.round((priceCents / IDR_PER_USD) * 100));
}
