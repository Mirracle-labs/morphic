// Shared billing copy: token amounts, what a package delivers, and its price in the viewer's
// currency. Indonesian shows Rupiah (Duitku), English shows USD (PayPal); both buy the same package.
import { BALANCE_CREDITS_PER_IDR, IDR_PER_1M_BASE_TOKENS, IDR_PER_USD, TOKEN_PACK_HOURS, multiplier, packagePriceIdr, packagePriceUsdCents } from '@morphic/shared/credits';

export type PackageKind = 'balance' | 'tokens' | 'unlimited';

export interface BillingPackage {
  id: string;
  name: string;
  kind: PackageKind;
  creditAllowance: number;
  durationHours: number | null;
  priceCents: number | null;
  currency: string;
  modelDisplayName?: string | null;
  modelPublicId?: string | null;
}

/** "10 jt" / "10M": the number alone, for big display figures. */
export const fmtCompact = (n: number, en: boolean) =>
  new Intl.NumberFormat(en ? 'en-US' : 'id-ID', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

/** "10 jt token" / "10M tokens". 1 credit = 1 base token. */
export function fmtTokens(n: number, en: boolean): string {
  return `${fmtCompact(n, en)} ${en ? 'tokens' : 'token'}`;
}

/** Rupiah a balance is worth at the top-up rate, for the "≈ Rp" hint. */
export const balanceIdr = (credits: number) => Math.floor(credits / BALANCE_CREDITS_PER_IDR);

/** Balance credits as money at the top-up rate: "Rp20.000" / "$1.10". */
export function fmtBalance(credits: number, en: boolean): string {
  const idr = balanceIdr(credits);
  return en ? `$${(idr / IDR_PER_USD).toFixed(2)}` : `Rp${idr.toLocaleString('id-ID')}`;
}

export function fmtDuration(hours: number, en: boolean): string {
  if (hours % 24 === 0) {
    const d = hours / 24;
    return en ? `${d} day${d === 1 ? '' : 's'}` : `${d} hari`;
  }
  return en ? `${hours} hours` : `${hours} jam`;
}

/** Price in the viewer's currency, as the gateway will charge it (PayPal floor included). */
export function fmtPrice(pkg: Pick<BillingPackage, 'priceCents' | 'currency'>, en: boolean): string {
  const cents = pkg.priceCents ?? 0;
  return en
    ? `$${(packagePriceUsdCents(cents, pkg.currency) / 100).toFixed(2)}`
    : `Rp${packagePriceIdr(cents, pkg.currency).toLocaleString('id-ID')}`;
}

/** One line on what the buyer gets and how it is charged. */
export function packageSummary(pkg: BillingPackage, en: boolean): string {
  const tokens = fmtTokens(pkg.creditAllowance, en);
  if (pkg.kind === 'unlimited') {
    const model = pkg.modelDisplayName ?? (en ? 'one model' : 'satu model');
    const span = fmtDuration(pkg.durationHours ?? 24, en);
    return en
      ? `${model} with no multiplier for ${span}, up to ${tokens} a day.`
      : `${model} tanpa multiplier selama ${span}, maksimal ${tokens} per hari.`;
  }
  if (pkg.kind === 'tokens') {
    const span = fmtDuration(pkg.durationHours ?? TOKEN_PACK_HOURS, en);
    return en
      ? `${tokens} for any model, charged by each model's multiplier. Valid ${span}.`
      : `${tokens} untuk semua model, dipotong sesuai multiplier model. Berlaku ${span}.`;
  }
  const money = fmtBalance(pkg.creditAllowance, en);
  return en
    ? `${money} added to your balance, spent at each model's per-token price. Never expires.`
    : `${money} masuk ke saldo, terpakai sesuai harga per token tiap model. Tidak hangus.`;
}

/** A model price (credits per 1M) as its token multiplier: "520x", "5,2x". */
export function fmtMultiplier(per1m: number, en = false): string {
  const x = multiplier(per1m);
  // Below 0.1x one decimal would round a real price down to "0x"; keep two significant digits.
  const opts = x > 0 && x < 0.1 ? { maximumSignificantDigits: 2 } : { maximumFractionDigits: x < 10 ? 1 : 0 };
  return `${x.toLocaleString(en ? 'en-US' : 'id-ID', opts)}x`;
}

/** What 1M tokens of that model cost out of a token pack: "Rp208.000/1M". */
export const fmtIdrPer1m = (per1m: number) => `Rp${Math.ceil(multiplier(per1m) * IDR_PER_1M_BASE_TOKENS).toLocaleString('id-ID')}/1M`;
