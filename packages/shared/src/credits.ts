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
export const IDR_PER_USD = 16_500;

/** Package price in Rupiah (`priceCents` holds whole Rupiah for IDR, cents for USD). */
export function packagePriceIdr(priceCents: number, currency: string | null | undefined): number {
  return currency === 'IDR' || !currency ? priceCents : Math.round((priceCents / 100) * IDR_PER_USD);
}

/** Package price in USD cents, never below PayPal's $1.00 floor for converted IDR packages. */
export function packagePriceUsdCents(priceCents: number, currency: string | null | undefined): number {
  return currency === 'USD' ? priceCents : Math.max(100, Math.round((priceCents / IDR_PER_USD) * 100));
}
