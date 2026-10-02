import { eq, desc, and, gt } from 'drizzle-orm';
import { db, schema as s } from '@morphic/db';
import { requireUser } from '@/lib/actions';
import { getBalance } from '@morphic/db/billing';
import { BillingView } from './billing-view';

export default async function BillingPage() {
  const user = await requireUser();

  // Read straight from Postgres. These five reads used to go through the gateway, whose
  // matching endpoints run exactly these queries against the same rows, so each one cost an
  // HTTPS round trip to another region for data this process can already reach. The gateway
  // still owns every write (minting keys, redeeming codes, creating payments).
  const [balance, packages, entitlements, payments, ledger] = await Promise.all([
    getBalance(user.id).catch((err) => {
      console.warn('[BillingPage] Balance read failed:', err);
      return 0;
    }),
    db
      .select({
        id: s.packages.id,
        name: s.packages.name,
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
      .catch((err) => {
        console.warn('[BillingPage] Package catalogue read failed:', err);
        return [] as any[];
      }),
    db
      .select({
        id: s.entitlements.id,
        allowance: s.entitlements.allowance,
        remaining: s.entitlements.remaining,
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
    db
      .select()
      .from(s.payments)
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
      })
      .from(s.creditLedger)
      .where(eq(s.creditLedger.userId, user.id))
      .orderBy(desc(s.creditLedger.createdAt))
      .limit(50)
      .catch((err) => {
        console.warn('[BillingPage] Credit ledger read failed:', err);
        return [] as any[];
      }),
  ]);

  return (
    <BillingView
      balance={balance}
      packages={packages}
      entitlements={entitlements}
      payments={payments}
      ledger={ledger}
    />
  );
}
