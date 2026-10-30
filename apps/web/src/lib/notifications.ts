// apps/web/src/lib/notifications.ts
// TypeScript / Next.js Server Module / Node.js / Linux x86_64
import { and, desc, eq, gt, isNotNull, ne } from 'drizzle-orm';
import { db, schema as s } from '@morphic/db';
import { memo } from './memo';

/** Raw facts only; the drawer composes the sentence in the viewer's language. */
export type NotificationItem = { id: string; at: string } & (
  | { kind: 'model'; type: 'model_new'; name: string; modelId: string; description: string | null }
  | { kind: 'model'; type: 'model_retired'; name: string; modelId: string; replacement: string | null }
  | { kind: 'account'; type: 'payment'; amountCents: number; currency: string; credits: number; gift: boolean }
  | { kind: 'account'; type: 'gift_redeemed'; credits: number }
  | { kind: 'changelog'; type: 'announcement'; title: string; body: string; linkUrl: string | null }
);

const WINDOW_MS = 90 * 86_400_000;
const GLOBAL_TTL_MS = 60_000;
const USER_TTL_MS = 15_000;

async function loadGlobalNotifications(): Promise<NotificationItem[]> {
  return memo('notifications:global', GLOBAL_TTL_MS, async () => {
    const since = new Date(Date.now() - WINDOW_MS);
    const [newModels, retired, posts] = await Promise.all([
      db
        .select({
          id: s.models.id,
          name: s.models.displayName,
          modelId: s.models.publicModelId,
          description: s.models.description,
          at: s.models.createdAt,
        })
        .from(s.models)
        .where(and(eq(s.models.status, 'active'), gt(s.models.createdAt, since))),
      db
        .select({
          id: s.models.id,
          name: s.models.displayName,
          modelId: s.models.publicModelId,
          replacement: s.models.replacementModelAlias,
          at: s.models.updatedAt,
        })
        .from(s.models)
        .where(eq(s.models.status, 'deprecated')),
      db.select().from(s.announcements).orderBy(desc(s.announcements.publishedAt)).limit(50),
    ]);

    return [
      ...newModels.map((m) => ({
        id: `mn-${m.id}`,
        at: m.at.toISOString(),
        kind: 'model' as const,
        type: 'model_new' as const,
        name: m.name,
        modelId: m.modelId,
        description: m.description,
      })),
      ...retired.map((m) => ({
        id: `mr-${m.id}`,
        at: m.at.toISOString(),
        kind: 'model' as const,
        type: 'model_retired' as const,
        name: m.name,
        modelId: m.modelId,
        replacement: m.replacement,
      })),
      ...posts.map((a) => ({
        id: `a-${a.id}`,
        at: a.publishedAt.toISOString(),
        kind: 'changelog' as const,
        type: 'announcement' as const,
        title: a.title,
        body: a.body,
        linkUrl: a.linkUrl,
      })),
    ];
  });
}

/** Everything the notification drawer shows, newest first. Built from existing rows, no fan-out table. */
export async function loadNotifications(userId: string): Promise<NotificationItem[]> {
  return memo(`notifications:user:${userId}`, USER_TTL_MS, async () => {
    const since = new Date(Date.now() - WINDOW_MS);
    const [globalItems, paid, redeemed] = await Promise.all([
      loadGlobalNotifications(),
      db
        .select({
          id: s.payments.id,
          amountCents: s.payments.amountCents,
          currency: s.payments.currency,
          credits: s.payments.credits,
          at: s.payments.paidAt,
          giftId: s.giftCards.id,
        })
        .from(s.payments)
        .leftJoin(s.giftCards, eq(s.giftCards.paymentId, s.payments.id))
        .where(
          and(
            eq(s.payments.userId, userId),
            eq(s.payments.status, 'paid'),
            isNotNull(s.payments.paidAt),
            gt(s.payments.paidAt, since),
          ),
        )
        .orderBy(desc(s.payments.paidAt))
        .limit(30),
      db
        .select({ id: s.redemptions.id, credits: s.payments.credits, at: s.redemptions.createdAt })
        .from(s.redemptions)
        .innerJoin(s.giftCards, eq(s.giftCards.redeemCodeId, s.redemptions.codeId))
        .innerJoin(s.payments, eq(s.payments.id, s.giftCards.paymentId))
        .where(and(eq(s.giftCards.purchaserId, userId), ne(s.redemptions.userId, userId), gt(s.redemptions.createdAt, since))),
    ]);

    const items: NotificationItem[] = [
      ...globalItems,
      ...paid.map((p) => ({
        id: `p-${p.id}`,
        at: p.at!.toISOString(),
        kind: 'account' as const,
        type: 'payment' as const,
        amountCents: p.amountCents,
        currency: p.currency,
        credits: p.credits,
        gift: p.giftId !== null,
      })),
      ...redeemed.map((r) => ({
        id: `g-${r.id}`,
        at: r.at.toISOString(),
        kind: 'account' as const,
        type: 'gift_redeemed' as const,
        credits: r.credits,
      })),
    ];
    return items.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 150);
  });
}
