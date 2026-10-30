// Sale catalogue: money-denominated balance top-ups, the 10M token pack, and a DeepSeek Local
// day pass. Idempotent: packages are upserted by name (unique); packages listed in RETIRE are set
// inactive, never deleted, because payments and entitlements reference them.
// Balance stays in credits at BALANCE_CREDITS_PER_IDR, so "Saldo Rp20.000" grants exactly the
// credits Rp20.000 buys and the dashboard shows it back as Rupiah.
// Presets start at Rp20.000 so the English (PayPal) price clears the $1.00 floor instead of
// charging $1 for Rp10.000 of balance.
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BALANCE_CREDITS_PER_IDR } from '@morphic/shared/credits';

const repoRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
// --dry-run prints every change it would make and writes nothing (run it first against production).
const DRY = process.argv.includes('--dry-run');
config({ path: resolve(repoRoot, '.env'), quiet: true });

const PASS_MODEL = 'deepseek-V4.1-Local';
const ONE_X = 1_000_000;

type Pkg = {
  name: string;
  kind: 'balance' | 'tokens' | 'unlimited';
  creditAllowance: number;
  priceCents: number;
  durationHours: number | null;
  model?: string;
};

const balance = (idr: number): Pkg => ({
  name: `Saldo Rp${idr.toLocaleString('id-ID')}`,
  kind: 'balance',
  creditAllowance: idr * BALANCE_CREDITS_PER_IDR,
  priceCents: idr,
  durationHours: null,
});

const CATALOGUE: Pkg[] = [
  balance(20_000),
  balance(50_000),
  balance(100_000),
  { name: 'Token Pack 10M', kind: 'tokens', creditAllowance: 10_000_000, priceCents: 4_000, durationHours: 720 },
  // Volume packs stay above cost: model prices are cost x1.3 at Rp400/1M, so the floor is ~Rp308/1M.
  { name: 'Token Pack 30M', kind: 'tokens', creditAllowance: 30_000_000, priceCents: 11_000, durationHours: 720 },
  { name: 'Token Pack 75M', kind: 'tokens', creditAllowance: 75_000_000, priceCents: 25_000, durationHours: 720 },
  // creditAllowance on an unlimited pass is raw tokens per day (fair use), no multiplier.
  { name: 'DeepSeek Local 1 Hari', kind: 'unlimited', creditAllowance: 20_000_000, priceCents: 5_000, durationHours: 24, model: PASS_MODEL },
];

// Token-denominated balance packs the money presets replace.
const RETIRE = ['Balance 20M', 'Balance 100M'];

async function main() {
  const { db } = await import('../src/index.ts');
  const s = await import('../src/schema.ts');
  const { eq, inArray } = await import('drizzle-orm');

  console.log(`database: ${new URL(process.env.DATABASE_URL!).hostname}${DRY ? ' (dry run, nothing is written)' : ''}`);

  const [model] = await db
    .select({ id: s.models.id, status: s.models.status })
    .from(s.models)
    .where(eq(s.models.publicModelId, PASS_MODEL))
    .limit(1);
  if (!model || model.status !== 'active') throw new Error(`pass model ${PASS_MODEL} missing or not active`);

  // The pass only beats pay-per-token if per-token sits at the 1x floor every other model uses;
  // at 0.0003x a 20M-token day cost ~Rp3 and the Rp5.000 pass was the dearer option.
  const [cur] = await db
    .select({ inp: s.models.inputCreditsPer1m, out: s.models.outputCreditsPer1m })
    .from(s.models)
    .where(eq(s.models.id, model.id));
  console.log(`price  ${PASS_MODEL} in ${cur!.inp} -> ${ONE_X}, out ${cur!.out} -> ${ONE_X} credits/1M`);
  if (!DRY) {
    await db.update(s.models).set({ inputCreditsPer1m: ONE_X, outputCreditsPer1m: ONE_X }).where(eq(s.models.id, model.id));
  }

  for (const p of CATALOGUE) {
    const values = {
      name: p.name,
      kind: p.kind,
      creditAllowance: p.creditAllowance,
      priceCents: p.priceCents,
      currency: 'IDR',
      durationHours: p.durationHours,
      modelId: p.model ? model.id : null,
      status: 'active' as const,
    };
    const [existing] = await db.select().from(s.packages).where(eq(s.packages.name, p.name)).limit(1);
    console.log(
      `${existing ? 'update' : 'add   '} ${p.name.padEnd(24)} ${p.kind.padEnd(9)} ${String(p.creditAllowance).padStart(11)} cr  Rp${p.priceCents.toLocaleString('id-ID')}` +
        (existing ? `  (was ${existing.kind} ${existing.creditAllowance} cr Rp${existing.priceCents} ${existing.status})` : ''),
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
