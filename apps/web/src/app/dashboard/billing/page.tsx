import { eq, asc, desc, and, gt, sql } from 'drizzle-orm';
import { db, schema as s } from '@morphic/db';
import { requireUser } from '@/lib/actions';
import { getBalance } from '@morphic/db/billing';
import { readyModelIds } from '@morphic/shared/model-readiness';
import { BillingView } from './billing-view';

/** Four routable models spread from cheapest to dearest output, for the "how far do N tokens go" strip. */
async function loadShowcase() {
  const [models, providers, pool] = await Promise.all([
    db
      .select({
        id: s.models.id,
        providerId: s.models.providerId,
        fallbackProviderId: s.models.fallbackProviderId,
        publicModelId: s.models.publicModelId,
        name: s.models.displayName,
        out: s.models.outputCreditsPer1m,
      })
      .from(s.models)
      .where(eq(s.models.status, 'active')),
    // Credential columns only decide readiness; they never reach the page.
    db
      .select({
        id: s.providers.id,
        status: s.providers.status,
        encryptedCredentials: s.providers.encryptedCredentials,
        credentialReference: s.providers.credentialReference,
      })
      .from(s.providers),
    db
      .select({ modelId: s.modelProviderPool.modelId, providerId: s.modelProviderPool.providerId, isEnabled: s.modelProviderPool.isEnabled })
      .from(s.modelProviderPool),
  ]);
  const ids = readyModelIds(models, providers, pool);
  // Skip near-free local models: "10M tokens buy 100 billion" would only mislead.
  const ready = models.filter((m) => ids.has(m.id) && m.out >= 1_000_000).sort((a, b) => a.out - b.out);
  const picks = ready.length <= 4 ? ready : [0, 1, 2, 3].map((i) => ready[Math.round((i * (ready.length - 1)) / 3)]!);
  return picks.map((m) => ({ id: m.publicModelId, name: m.name, out: m.out }));
}

export default async function BillingPage(props: {
  searchParams?: Promise<{ tab?: string }>;
}) {
  const searchParams = await props.searchParams;
  const initialTab =
    searchParams?.tab === 'payments' || searchParams?.tab === 'ledger'
      ? searchParams.tab
      : 'packages';
  const user = await requireUser();

  // Read straight from Postgres. These five reads used to go through the gateway, whose
  // matching endpoints run exactly these queries against the same rows, so each one cost an
  // HTTPS round trip to another region for data this process can already reach. The gateway
  // still owns every write (minting keys, redeeming codes, creating payments).
  const [balance, packages, entitlements, payments, ledger, showcase] = await Promise.all([
    getBalance(user.id).catch((err) => {
      console.warn('[BillingPage] Balance read failed:', err);
      return 0;
    }),
    db
      .select({
        id: s.packages.id,
        name: s.packages.name,
        kind: s.packages.kind,
        description: s.packages.description,
        creditAllowance: s.packages.creditAllowance,
        modelId: s.packages.modelId,
        durationHours: s.packages.durationHours,
        priceCents: s.packages.priceCents,
        currency: s.packages.currency,
        status: s.packages.status,
        modelDisplayName: s.models.displayName,
        modelPublicId: s.models.publicModelId,
      })
      .from(s.packages)
      .leftJoin(s.models, eq(s.packages.modelId, s.models.id))
      .where(eq(s.packages.status, 'active'))
      .orderBy(asc(s.packages.priceCents))
      .catch((err) => {
        console.warn('[BillingPage] Package catalogue read failed:', err);
        return [] as any[];
      }),
    db
      .select({
        id: s.entitlements.id,
        allowance: s.entitlements.allowance,
        remaining: s.entitlements.remaining,
        unlimited: s.entitlements.unlimited,
        resetsAt: s.entitlements.resetsAt,
        expiresAt: s.entitlements.expiresAt,
        packageName: s.packages.name,
        displayName: s.models.displayName,
      })
      .from(s.entitlements)
      .leftJoin(s.packages, eq(s.entitlements.packageId, s.packages.id))
      .leftJoin(s.models, eq(s.entitlements.modelId, s.models.id))
      .where(
        and(
          eq(s.entitlements.userId, user.id),
          eq(s.entitlements.status, 'active'),
          gt(s.entitlements.expiresAt, new Date()),
        ),
      )
      .catch((err) => {
        console.warn('[BillingPage] Entitlement read failed:', err);
        return [] as any[];
      }),
    // Explicit columns: capture ids, reconcile timestamps and refund amounts stay on the server.
    db
      .select({
        id: s.payments.id,
        provider: s.payments.provider,
        externalId: s.payments.externalId,
        packageId: s.payments.packageId,
        packageName: s.packages.name,
        amountCents: s.payments.amountCents,
        currency: s.payments.currency,
        credits: s.payments.credits,
        status: s.payments.status,
        paidAt: s.payments.paidAt,
        createdAt: s.payments.createdAt,
      })
      .from(s.payments)
      .leftJoin(s.packages, eq(s.payments.packageId, s.packages.id))
      .where(eq(s.payments.userId, user.id))
      .orderBy(desc(s.payments.createdAt))
      .limit(20)
      .catch((err) => {
        console.warn('[BillingPage] Payment history read failed:', err);
        return [] as any[];
      }),
    db
      .select({
        id: s.creditLedger.id,
        entryType: s.creditLedger.entryType,
        amount: s.creditLedger.amount,
        sourceType: s.creditLedger.sourceType,
        reference: s.creditLedger.reference,
        createdAt: s.creditLedger.createdAt,
        // Human-readable source, resolved in the same query: the redeem code or the package bought.
        redeemCode: s.redeemCodes.code,
        packageName: s.packages.name,
      })
      .from(s.creditLedger)
      .leftJoin(s.redeemCodes, sql`${s.creditLedger.reference} = 'code:' || ${s.redeemCodes.id}::text`)
      .leftJoin(s.payments, sql`${s.creditLedger.reference} = 'payment:' || ${s.payments.id}::text`)
      .leftJoin(s.packages, eq(s.payments.packageId, s.packages.id))
      .where(eq(s.creditLedger.userId, user.id))
      .orderBy(desc(s.creditLedger.createdAt))
      .limit(50)
      .catch((err) => {
        console.warn('[BillingPage] Credit ledger read failed:', err);
        return [] as any[];
      }),
    // Real multipliers for the "how far do 10M tokens go" strip, cheap to expensive.
    loadShowcase().catch(() => [] as { id: string; name: string; out: number }[]),
  ]);

  return (
    <BillingView
      balance={balance}
      packages={packages}
      entitlements={entitlements}
      payments={payments}
      ledger={ledger}
      showcase={showcase}
      initialTab={initialTab}
    />
  );
}
