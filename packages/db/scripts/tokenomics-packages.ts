// Sale catalogue: money-denominated balance top-ups, six token packs, and two unlimited day passes.
// Idempotent: packages are upserted by name (unique); packages listed in RETIRE are set inactive,
// never deleted, because payments and entitlements reference them.
// Balance stays in credits at BALANCE_CREDITS_PER_IDR, so "Saldo Rp20.000" grants exactly the
// credits Rp20.000 buys and the dashboard shows it back as Rupiah.
// Presets start at Rp20.000 so the English (PayPal) price clears the $1.00 floor instead of
// charging $1 for Rp10.000 of balance.
//
// Profit guard (checked before anything is written):
// - Token packs: every model sells at >= 1.3x its upstream cost at Rp400 per 1M base tokens, so a
//   pack loses money below Rp400/1.3 ≈ Rp308 per 1M. Packs must clear that plus a payment-fee buffer.
// - Unlimited passes meter input-equivalent tokens (see passPricing), so one cap unit costs the
//   model's upstream input price. A pass must clear cap x that cost plus the same buffer.
//
// --glm-live activates the GLM pass. Leave it off until the production API has INCEPTRON_API_KEY:
// without it every GLM request fails with provider_not_configured.
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BALANCE_CREDITS_PER_IDR, IDR_PER_1M_BASE_TOKENS, PRICE_MARKUP } from '@morphic/shared/credits';

const repoRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
// --dry-run prints every change it would make and writes nothing (run it first against production).
const DRY = process.argv.includes('--dry-run');
const GLM_LIVE = process.argv.includes('--glm-live');
config({ path: resolve(repoRoot, '.env'), quiet: true });

const LOCAL_MODEL = 'deepseek-V4.1-Local';
const GLM_MODEL = 'z-ai/glm-5.3-flash';
const ONE_X = 1_000_000;
/** Payment gateway fees and rounding: prices must clear cost by at least this much. */
const FEE_BUFFER = 1.05;
const PACK_FLOOR_IDR_PER_1M = (IDR_PER_1M_BASE_TOKENS / PRICE_MARKUP) * FEE_BUFFER;

type Pkg = {
  name: string;
  kind: 'balance' | 'tokens' | 'unlimited';
  creditAllowance: number;
  priceCents: number;
  durationHours: number | null;
  model?: string;
  active?: boolean;
};

const balance = (idr: number): Pkg => ({
  name: `Saldo Rp${idr.toLocaleString('id-ID')}`,
  kind: 'balance',
  creditAllowance: idr * BALANCE_CREDITS_PER_IDR,
  priceCents: idr,
  durationHours: null,
});

const pack = (millions: number, idr: number): Pkg => ({
  name: `Token Pack ${millions}M`,
  kind: 'tokens',
  creditAllowance: millions * 1_000_000,
  priceCents: idr,
  durationHours: 720,
});

const CATALOGUE: Pkg[] = [
  balance(20_000),
  balance(50_000),
  balance(100_000),
  // Rp400 → Rp350 per 1M as packs grow; worst case (all tokens on 1.3x models) still 30% → 14% over cost.
  pack(10, 4_000),
  pack(20, 7_800),
  pack(30, 11_400),
  pack(50, 18_500),
  pack(75, 27_000),
  pack(100, 35_000),
  // creditAllowance on an unlimited pass is input-equivalent tokens per day (fair use), no multiplier.
  { name: 'DeepSeek Local 1 Hari', kind: 'unlimited', creditAllowance: 20_000_000, priceCents: 5_000, durationHours: 24, model: LOCAL_MODEL },
  { name: 'GLM 5.3 Flash 1 Hari', kind: 'unlimited', creditAllowance: 5_000_000, priceCents: 15_000, durationHours: 24, model: GLM_MODEL, active: GLM_LIVE },
];

// Token-denominated balance packs the money presets replace.
const RETIRE = ['Balance 20M', 'Balance 100M'];

async function main() {
  const { db } = await import('../src/index.ts');
  const s = await import('../src/schema.ts');
  const { eq, inArray } = await import('drizzle-orm');

  console.log(`database: ${new URL(process.env.DATABASE_URL!).hostname}${DRY ? ' (dry run, nothing is written)' : ''}`);

  const passModels = [...new Set(CATALOGUE.flatMap((p) => (p.model ? [p.model] : [])))];
  const models = await db
    .select({
      id: s.models.id,
      publicModelId: s.models.publicModelId,
      status: s.models.status,
      inp: s.models.inputCreditsPer1m,
      out: s.models.outputCreditsPer1m,
      costIn: s.models.providerCostInputPer1m,
    })
    .from(s.models)
    .where(inArray(s.models.publicModelId, passModels));
  const byId = new Map(models.map((m) => [m.publicModelId, m]));
  for (const id of passModels) {
    const m = byId.get(id);
    if (!m || m.status !== 'active') throw new Error(`pass model ${id} missing or not active`);
  }

  // Profit guard, before any write.
  for (const p of CATALOGUE) {
    const perM = p.priceCents / (p.creditAllowance / 1_000_000);
    if (p.kind === 'tokens' && perM < PACK_FLOOR_IDR_PER_1M) {
      throw new Error(`${p.name}: Rp${perM.toFixed(0)}/1M is below the Rp${PACK_FLOOR_IDR_PER_1M.toFixed(0)}/1M floor`);
    }
    if (p.kind === 'unlimited') {
      const m = byId.get(p.model!)!;
      // Self-hosted models carry no upstream cost; anything above zero clears it.
      const costIdrPer1m = ((m.costIn ?? 0) / 1_000_000) * IDR_PER_1M_BASE_TOKENS;
      const worstCost = costIdrPer1m * (p.creditAllowance / 1_000_000);
      if (p.priceCents < worstCost * FEE_BUFFER) {
        throw new Error(`${p.name}: Rp${p.priceCents} does not cover a full day's upstream cost Rp${worstCost.toFixed(0)} + buffer`);
      }
      console.log(`check  ${p.name}: full-cap upstream cost Rp${worstCost.toFixed(0)}, price Rp${p.priceCents} (${worstCost ? `${((p.priceCents / worstCost - 1) * 100).toFixed(1)}% margin` : 'self-hosted'})`);
    }
  }

  // The Local pass only beats pay-per-token if per-token sits at the 1x floor every other model uses;
  // at 0.0003x a 20M-token day cost ~Rp3 and the Rp5.000 pass was the dearer option.
  const local = byId.get(LOCAL_MODEL)!;
  if (local.inp !== ONE_X || local.out !== ONE_X) {
    console.log(`price  ${LOCAL_MODEL} in ${local.inp} -> ${ONE_X}, out ${local.out} -> ${ONE_X} credits/1M`);
    if (!DRY) {
      await db.update(s.models).set({ inputCreditsPer1m: ONE_X, outputCreditsPer1m: ONE_X }).where(eq(s.models.id, local.id));
    }
  }

  for (const p of CATALOGUE) {
    const values = {
      name: p.name,
      kind: p.kind,
      creditAllowance: p.creditAllowance,
      priceCents: p.priceCents,
      currency: 'IDR',
      durationHours: p.durationHours,
      modelId: p.model ? byId.get(p.model)!.id : null,
      status: p.active === false ? ('inactive' as const) : ('active' as const),
    };
    const [existing] = await db.select().from(s.packages).where(eq(s.packages.name, p.name)).limit(1);
    console.log(
      `${existing ? 'update' : 'add   '} ${p.name.padEnd(24)} ${p.kind.padEnd(9)} ${String(p.creditAllowance).padStart(11)} cr  Rp${p.priceCents.toLocaleString('id-ID').padEnd(8)} ${values.status}` +
        (existing ? `  (was ${existing.creditAllowance} cr Rp${existing.priceCents} ${existing.status})` : ''),
    );
    if (DRY) continue;
    await db.insert(s.packages).values(values).onConflictDoUpdate({ target: s.packages.name, set: values });
  }

  const retiring = await db
    .select({ name: s.packages.name, status: s.packages.status })
    .from(s.packages)
    .where(inArray(s.packages.name, RETIRE));
  for (const r of retiring) console.log(`retire ${r.name} (${r.status} -> inactive)`);
  if (!DRY && retiring.length) {
    await db.update(s.packages).set({ status: 'inactive' }).where(inArray(s.packages.name, RETIRE));
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
