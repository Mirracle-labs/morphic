import { db, schema as s } from '@morphic/db';
import { requireAdmin } from '@/lib/actions';
import { getServerTranslation } from '@/lib/i18n/server';
import { sql, gte } from 'drizzle-orm';
import { Server } from 'lucide-react';
import { Suspense } from 'react';
import { fetchAllProviderCatalogs } from '@/lib/admin-actions';
import { ProvidersClient, type ProviderRow, type ProviderStat } from './providers-client';
import { ProviderCatalog, ProviderCatalogSkeleton } from './provider-catalog';

// Streams in after the providers table, so slow upstreams don't block the page.
async function CatalogSection() {
  const catalogs = await fetchAllProviderCatalogs();
  // New key whenever the server refetched (e.g. after a provider edit), so client state resets.
  const key = Object.entries(catalogs).map(([n, r]) => n + r.fetchedAt).join();
  return <ProviderCatalog key={key} initial={catalogs} />;
}

export const dynamic = 'force-dynamic';

export default async function AdminProviders() {
  await requireAdmin();
  const { t } = await getServerTranslation();

  const providers = await db.select().from(s.providers);

  // 5-minute live health monitoring for Observability Alerts (§5.7)
  const fiveMinCutoff = new Date(Date.now() - 5 * 60_000);
  const liveStats = await db
    .select({
      providerName: s.requestLogs.providerName,
      totalRequests: sql<number>`count(*)::int`,
      errorRequests: sql<number>`count(case when ${s.requestLogs.status} = 'error' then 1 end)::int`,
    })
    .from(s.requestLogs)
    .where(gte(s.requestLogs.createdAt, fiveMinCutoff))
    .groupBy(s.requestLogs.providerName);

  const stats: ProviderStat[] = liveStats
    .filter((s): s is typeof s & { providerName: string } => Boolean(s.providerName))
    .map((s) => ({
      providerName: s.providerName,
      totalRequests: s.totalRequests,
      errorRequests: s.errorRequests,
    }));

  const formattedProviders: ProviderRow[] = providers.map((p) => ({
    id: p.id,
    name: p.name,
    baseUrl: p.baseUrl,
    // Ciphertext stays on the server; the table only needs to know a key is stored.
    hasEncryptedCredential: Boolean(p.encryptedCredentials),
    credentialReference: p.credentialReference,
    status: p.status as 'active' | 'disabled',
  }));

  return (
    <div className="space-y-6 w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-5 border-b border-neutral-200/80">
        <div>
          <h1 className="text-xl sm:text-2xl font-heading font-extrabold tracking-tight text-neutral-950 flex items-center gap-2">
            <Server className="w-5 h-5 text-neutral-700" />
            {t.admin.providers.title}
          </h1>
          <p className="text-xs sm:text-sm text-neutral-500 mt-0.5">
            {t.admin.providers.desc}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-neutral-700 font-mono font-medium bg-neutral-100 px-3 py-1.5 rounded-full border border-neutral-200 self-start sm:self-auto">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" aria-hidden="true" />
          <span>{t.admin.providers.liveMonitor}</span>
        </div>
      </div>

      <ProvidersClient initialProviders={formattedProviders} stats={stats} />

      <Suspense fallback={<ProviderCatalogSkeleton />}>
        <CatalogSection />
      </Suspense>
    </div>
  );
}
