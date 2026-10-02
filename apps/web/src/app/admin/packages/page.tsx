import { db, schema as s } from '@morphic/db';
import { requireAdmin } from '@/lib/actions';
import { savePackage } from '@/lib/admin-actions';
import { formatCredits } from '@/lib/utils';
import { getServerTranslation } from '@/lib/i18n/server';
import { Package, Plus } from 'lucide-react';

export default async function AdminPackages() {
  await requireAdmin();
  const { t } = await getServerTranslation();

  const [packages, models] = await Promise.all([
    db.select().from(s.packages),
    db.select({ id: s.models.id, displayName: s.models.displayName }).from(s.models),
  ]);
  const modelName = (id: string | null) => models.find((m) => m.id === id)?.displayName ?? t.admin.packages.allModels;

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-5 border-b border-neutral-200/80">
        <div>
          <h1 className="text-xl sm:text-2xl font-heading font-extrabold tracking-tight text-neutral-950 flex items-center gap-2">
            <Package className="w-5 h-5 text-neutral-700" />
            {t.admin.packages.title}
          </h1>
          <p className="text-xs sm:text-sm text-neutral-500 mt-0.5">
            {t.admin.packages.desc}
          </p>
        </div>
      </div>

      {/* Create Package Card */}
      <div className="bg-white p-6 rounded-2xl border border-neutral-200/90 shadow-xs">
        <div className="flex items-center gap-2 mb-4 pb-3 border-b border-neutral-100">
          <Plus className="w-4 h-4 text-neutral-700" />
          <h2 className="text-sm font-heading font-bold text-neutral-950">{t.admin.packages.createTitle}</h2>
        </div>
        <form action={savePackage} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          <div>
            <label htmlFor="pkg-name" className="block text-[11px] font-mono font-semibold uppercase tracking-wider text-neutral-500 mb-1">
              {t.admin.packages.thName}
            </label>
            <input
              id="pkg-name"
              name="name"
              aria-label="Package Name"
              className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-neutral-50 text-neutral-900 placeholder:text-neutral-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
              placeholder="DeepSeek V4 — 1 Day"
              required
            />
          </div>

          <div>
            <label htmlFor="pkg-desc" className="block text-[11px] font-mono font-semibold uppercase tracking-wider text-neutral-500 mb-1">
              Description
            </label>
            <input
              id="pkg-desc"
              name="description"
              aria-label="Description"
              className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-neutral-50 text-neutral-900 placeholder:text-neutral-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
              placeholder="Unlimited for 24 hours (fair use)"
            />
          </div>

          <div>
            <label htmlFor="pkg-model" className="block text-[11px] font-mono font-semibold uppercase tracking-wider text-neutral-500 mb-1">
              {t.admin.packages.thModel}
            </label>
            <select
              id="pkg-model"
              name="modelId"
              aria-label="Model Restriction"
              className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-neutral-50 text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
            >
              <option value="">{t.admin.packages.allModels}</option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>{m.displayName}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="pkg-allowance" className="block text-[11px] font-mono font-semibold uppercase tracking-wider text-neutral-500 mb-1">
              {t.admin.packages.thAllowance}
            </label>
            <input
              id="pkg-allowance"
              name="creditAllowance"
              aria-label="Credit Allowance"
              className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-neutral-50 text-neutral-900 placeholder:text-neutral-500 font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
              type="number"
              placeholder="100000"
              required
            />
          </div>

          <div>
            <label htmlFor="pkg-duration" className="block text-[11px] font-mono font-semibold uppercase tracking-wider text-neutral-500 mb-1">
              {t.admin.packages.thDuration} (Hours)
            </label>
            <input
              id="pkg-duration"
              name="durationHours"
              aria-label="Duration in hours"
              className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-neutral-50 text-neutral-900 placeholder:text-neutral-500 font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
              type="number"
              placeholder="24"
            />
          </div>

          <div>
            <label htmlFor="pkg-price" className="block text-[11px] font-mono font-semibold uppercase tracking-wider text-neutral-500 mb-1">
              {t.admin.packages.thPrice} (IDR)
            </label>
            <div className="flex gap-2">
              <input
                id="pkg-price"
                name="priceCents"
                aria-label="Price in IDR"
                className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-neutral-50 text-neutral-900 placeholder:text-neutral-500 font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
                type="number"
                placeholder="25000"
              />
              <button
                type="submit"
                className="px-4 py-2 text-xs font-semibold rounded-xl bg-neutral-950 text-white hover:bg-neutral-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 cursor-pointer shadow-xs whitespace-nowrap"
              >
                {t.admin.packages.createBtn}
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Packages Table Card */}
      <div className="bg-white rounded-2xl border border-neutral-200/90 shadow-xs overflow-hidden">
        {packages.length === 0 ? (
          <div className="p-8 text-center text-xs text-neutral-500">{t.admin.packages.noPackages}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-neutral-200/80 bg-neutral-50/50">
                  <th className="text-left font-mono font-semibold uppercase tracking-wider text-neutral-500 py-3 px-4">{t.admin.packages.thName}</th>
                  <th className="text-left font-mono font-semibold uppercase tracking-wider text-neutral-500 py-3 px-3">{t.admin.packages.thModel}</th>
                  <th className="text-right font-mono font-semibold uppercase tracking-wider text-neutral-500 py-3 px-3">{t.admin.packages.thAllowance}</th>
                  <th className="text-left font-mono font-semibold uppercase tracking-wider text-neutral-500 py-3 px-3">{t.admin.packages.thDuration}</th>
                  <th className="text-right font-mono font-semibold uppercase tracking-wider text-neutral-500 py-3 px-3">{t.admin.packages.thPrice}</th>
                  <th className="text-right font-mono font-semibold uppercase tracking-wider text-neutral-500 py-3 px-4">{t.admin.packages.thStatus}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {packages.map((p) => (
                  <tr key={p.id} className="hover:bg-neutral-50/60 transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-semibold text-neutral-950">{p.name}</div>
                      {p.description && <div className="text-[11px] text-neutral-500 mt-0.5">{p.description}</div>}
                    </td>
                    <td className="py-3 px-3 font-medium text-neutral-800">{modelName(p.modelId)}</td>
                    <td className="py-3 px-3 text-right font-mono font-semibold text-neutral-950">{formatCredits(p.creditAllowance)}</td>
                    <td className="py-3 px-3 font-mono text-neutral-600">{p.durationHours ? `${p.durationHours}h` : '—'}</td>
                    <td className="py-3 px-3 text-right font-mono font-semibold text-neutral-950">
                      {p.priceCents ? `Rp${p.priceCents.toLocaleString('id-ID')}` : '—'}
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      {p.status === 'active' ? (
                        <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-medium text-neutral-700">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" aria-hidden="true" />
                          {t.admin.status.active}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-medium text-neutral-500">
                          <span className="w-1.5 h-1.5 rounded-full bg-neutral-400 shrink-0" aria-hidden="true" />
                          {p.status}
                        </span>
                      )}
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
