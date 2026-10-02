import { eq, desc, and, gt } from 'drizzle-orm';
import { db, schema as s } from '@morphic/db';
import { requireUser } from '@/lib/actions';
import { getBalance } from '@morphic/db/billing';
import { formatCredits } from '@/lib/utils';
import { BuyPackages } from './buy-packages';
import { Zap, CreditCard, ShieldCheck, Clock } from 'lucide-react';

const FALLBACK_CHEAP_PACKAGES = [
  {
    id: 'pkg-v4-1day',
    name: 'Pass Harian DeepSeek V4',
    description: 'Akses penuh 24 jam untuk coding model DeepSeek V4 di Cursor & Cline.',
    priceCents: 2500,
    creditAllowance: 15000,
    durationHours: 24,
  },
  {
    id: 'pkg-qwen-1day',
    name: 'Pass Harian Qwen Max',
    description: 'Akses 24 jam model serba bisa Qwen 2.5 Max bahasa Indonesia alami.',
    priceCents: 3500,
    creditAllowance: 22000,
    durationHours: 24,
  },
  {
    id: 'pkg-r1-1day',
    name: 'Pass Harian DeepSeek R1',
    description: 'Akses 24 jam model penalaran bertahap Chain-of-Thought.',
    priceCents: 4500,
    creditAllowance: 28000,
    durationHours: 24,
  },
  {
    id: 'pkg-all-1day',
    name: 'All-Access Pass (24 Jam)',
    description: 'Akses bebas seluruh model (DeepSeek, Qwen, Kimi, GLM) selama 24 jam.',
    priceCents: 7500,
    creditAllowance: 45000,
    durationHours: 24,
  },
  {
    id: 'pkg-micro-5k',
    name: 'Mikro Saldo 30K',
    description: 'Top up saldo fleksibel tanpa hangus untuk pemakaian sewaktu-waktu.',
    priceCents: 5000,
    creditAllowance: 30000,
    durationHours: 24 * 30,
  },
  {
    id: 'pkg-week-9k',
    name: 'Paket Hemat Mingguan',
    description: 'Kredit cukup untuk 7 hari pemakaian coding harian intensif.',
    priceCents: 9900,
    creditAllowance: 70000,
    durationHours: 24 * 7,
  },
];

export default async function BillingPage() {
  const user = await requireUser();
  const [balance, dbPackages, entitlements, payments] = await Promise.all([
    getBalance(user.id),
    db.select().from(s.packages).where(eq(s.packages.status, 'active')),
    db
      .select({
        id: s.entitlements.id,
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
      ),
    db
      .select()
      .from(s.payments)
      .where(eq(s.payments.userId, user.id))
      .orderBy(desc(s.payments.createdAt))
      .limit(20),
  ]);

  const displayPackages = dbPackages.length > 0 ? dbPackages : FALLBACK_CHEAP_PACKAGES;

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-8 py-8 space-y-8">
      {/* Header & Balance card */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-neutral-200/70">
        <div>
          <h1 className="text-2xl md:text-3xl font-heading font-extrabold text-neutral-950">
            Billing & Paket Harian
          </h1>
          <p className="text-xs md:text-sm text-neutral-500 mt-1">
            Beli paket harian di bawah Rp 10.000 atau saldo kredit instan via QRIS.
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-white border border-neutral-200/90 shadow-sm flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-700">
            <Zap className="h-5 w-5" />
          </div>
          <div>
            <div className="text-[10px] uppercase font-mono text-neutral-400 font-bold">Saldo Aktif</div>
            <div className="text-xl font-extrabold text-neutral-950">
              {formatCredits(balance)} <span className="text-xs text-neutral-500 font-normal">credits</span>
            </div>
          </div>
        </div>
      </div>

      {/* Daily Passes & Cheap Packages Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CreditCard className="h-4 w-4 text-neutral-950" />
            <h2 className="font-heading font-bold text-lg text-neutral-950">
              Pilihan Paket Harian & Mikro (&lt; Rp 10.000)
            </h2>
          </div>
          <span className="text-xs font-semibold text-emerald-800 bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200">
            Scan QRIS Instan
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {displayPackages.map((p) => (
            <div
              key={p.id}
              className="p-5 rounded-2xl bg-white border border-neutral-200/90 shadow-sm hover:border-neutral-300 hover:shadow-md transition-all flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <h3 className="font-heading font-bold text-base text-neutral-950">{p.name}</h3>
                  <span className="text-[10px] font-bold text-neutral-600 bg-neutral-100 px-2 py-0.5 rounded-full">
                    {p.durationHours ? `${p.durationHours} Jam` : 'Kredit'}
                  </span>
                </div>
                <p className="text-xs text-neutral-500 mb-4 leading-relaxed">{p.description}</p>
              </div>

              <div className="pt-4 border-t border-neutral-100 space-y-3">
                <div className="flex items-baseline justify-between">
                  <div className="text-xl font-extrabold text-neutral-950">
                    Rp {(p.priceCents ?? 0).toLocaleString('id-ID')}
                  </div>
                  <div className="text-xs font-semibold text-emerald-700">
                    +{formatCredits(p.creditAllowance)} credits
                  </div>
                </div>
                <BuyPackages packageId={p.id} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Active Entitlements / Passes */}
      {entitlements.length > 0 && (
        <div className="p-6 rounded-3xl bg-white border border-neutral-200/90 shadow-sm space-y-3">
          <div className="text-sm font-bold text-neutral-950 flex items-center gap-2">
            <Clock className="h-4 w-4 text-neutral-600" />
            <span>Paket Harian Aktif</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b text-neutral-400 font-mono">
                  <th className="py-2">Paket</th>
                  <th className="py-2">Model</th>
                  <th className="py-2 text-right">Sisa Kredit</th>
                  <th className="py-2 text-right">Kedaluwarsa</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {entitlements.map((e) => (
                  <tr key={e.id}>
                    <td className="py-2.5 font-semibold text-neutral-900">{e.packageName ?? 'Daily Pass'}</td>
                    <td className="py-2.5 text-neutral-600">{e.displayName ?? 'Semua Model'}</td>
                    <td className="py-2.5 text-right font-mono font-bold text-emerald-700">
                      {formatCredits(e.remaining)}
                    </td>
                    <td className="py-2.5 text-right text-neutral-500">{e.expiresAt.toLocaleString('id-ID')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Transaction History */}
      <div className="p-6 rounded-3xl bg-white border border-neutral-200/90 shadow-sm space-y-3">
        <div className="text-sm font-bold text-neutral-950">Riwayat Pembayaran QRIS</div>
        {payments.length === 0 ? (
          <div className="text-xs text-neutral-400 py-4 text-center">Belum ada riwayat transaksi.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b text-neutral-400 font-mono">
                  <th className="py-2">Tanggal</th>
                  <th className="py-2">Kredit</th>
                  <th className="py-2">Nominal</th>
                  <th className="py-2 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td className="py-2.5 text-neutral-600">{p.createdAt.toLocaleDateString('id-ID')}</td>
                    <td className="py-2.5 font-mono text-emerald-700 font-bold">+{formatCredits(p.credits)}</td>
                    <td className="py-2.5 font-bold text-neutral-900">Rp {p.amountCents.toLocaleString('id-ID')}</td>
                    <td className="py-2.5 text-right">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          p.status === 'paid'
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                            : 'bg-neutral-100 text-neutral-600'
                        }`}
                      >
                        {p.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
