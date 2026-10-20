import { and, eq, desc, gt, isNull, ne } from 'drizzle-orm';
import { db, schema as s } from '@morphic/db';
import { requireUser } from '@/lib/actions';
import { RedeemView, type GiftTransaction } from './redeem-view';

const OPEN = ['pending', 'pending_paypal', 'capturing'];
const FAILED = ['failed', 'expired'];

// Same view for every role. Admins create codes in the admin panel (/admin/codes).
export default async function RedeemPage() {
  const user = await requireUser();
  const warnEmpty = (what: string) => (err: unknown) => {
    console.warn(`[RedeemPage] ${what} read failed:`, err);
    return [];
  };

  const [coupons, giftPackages, sent, received] = await Promise.all([
    // Every entitlement the user ever held, so the coupon list can show used/expired ones too.
    db
      .select({
        id: s.entitlements.id,
        allowance: s.entitlements.allowance,
        remaining: s.entitlements.remaining,
        source: s.entitlements.source,
        status: s.entitlements.status,
        expiresAt: s.entitlements.expiresAt,
        packageName: s.packages.name,
        modelName: s.models.displayName,
      })
      .from(s.entitlements)
      .leftJoin(s.packages, eq(s.entitlements.packageId, s.packages.id))
      .leftJoin(s.models, eq(s.entitlements.modelId, s.models.id))
      .where(eq(s.entitlements.userId, user.id))
      .orderBy(desc(s.entitlements.createdAt))
      .limit(100)
      .catch(warnEmpty('Entitlement')),
    // Gift card amounts = priced credit packages (model passes cannot become credit codes).
    db
      .select({
        id: s.packages.id,
        name: s.packages.name,
        priceCents: s.packages.priceCents,
        currency: s.packages.currency,
        creditAllowance: s.packages.creditAllowance,
      })
      .from(s.packages)
      .where(and(eq(s.packages.status, 'active'), isNull(s.packages.modelId), gt(s.packages.priceCents, 0)))
      .orderBy(s.packages.priceCents)
      .catch(warnEmpty('Gift package')),
    db
      .select({
        id: s.giftCards.id,
        createdAt: s.giftCards.createdAt,
        design: s.giftCards.design,
        recipientEmail: s.giftCards.recipientEmail,
        amountCents: s.payments.amountCents,
        currency: s.payments.currency,
        credits: s.payments.credits,
        paymentStatus: s.payments.status,
        code: s.redeemCodes.code,
        redeemedCount: s.redeemCodes.redeemedCount,
      })
      .from(s.giftCards)
      .innerJoin(s.payments, eq(s.payments.id, s.giftCards.paymentId))
      .leftJoin(s.redeemCodes, eq(s.redeemCodes.id, s.giftCards.redeemCodeId))
      .where(eq(s.giftCards.purchaserId, user.id))
      .orderBy(desc(s.giftCards.createdAt))
      .limit(50)
      .catch(warnEmpty('Sent gift')),
    db
      .select({
        id: s.giftCards.id,
        createdAt: s.redemptions.createdAt,
        design: s.giftCards.design,
        credits: s.payments.credits,
        fromEmail: s.users.email,
      })
      .from(s.redemptions)
      .innerJoin(s.giftCards, eq(s.giftCards.redeemCodeId, s.redemptions.codeId))
      .innerJoin(s.payments, eq(s.payments.id, s.giftCards.paymentId))
      .innerJoin(s.users, eq(s.users.id, s.giftCards.purchaserId))
      .where(and(eq(s.redemptions.userId, user.id), ne(s.giftCards.purchaserId, user.id)))
      .orderBy(desc(s.redemptions.createdAt))
      .limit(50)
      .catch(warnEmpty('Received gift')),
  ]);

  const transactions: GiftTransaction[] = [
    ...sent.map((g) => ({
      id: g.id,
      date: g.createdAt.toISOString(),
      direction: 'sent' as const,
      design: g.design,
      credits: g.credits,
      amountCents: g.amountCents,
      currency: g.currency,
      from: null,
      to: g.recipientEmail,
      code: g.paymentStatus === 'paid' ? g.code : null,
      status: OPEN.includes(g.paymentStatus)
        ? ('pending' as const)
        : FAILED.includes(g.paymentStatus)
          ? ('failed' as const)
          : g.paymentStatus !== 'paid'
            ? ('on_hold' as const)
            : (g.redeemedCount ?? 0) > 0
              ? ('redeemed' as const)
              : ('ready' as const),
    })),
    ...received.map((g) => ({
      id: `r-${g.id}`,
      date: g.createdAt.toISOString(),
      direction: 'received' as const,
      design: g.design,
      credits: g.credits,
      amountCents: null,
      currency: null,
      from: g.fromEmail,
      to: null,
      code: null,
      status: 'redeemed' as const,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <RedeemView
      coupons={coupons.map((c) => ({ ...c, expiresAt: c.expiresAt.toISOString() }))}
      giftPackages={giftPackages.map((p) => ({ ...p, priceCents: p.priceCents ?? 0 }))}
      transactions={transactions}
    />
  );
}
