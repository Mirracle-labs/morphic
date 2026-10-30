'use client';

import { useState, useTransition } from 'react';
import { saveModel, deleteModel } from '@/lib/admin-actions';
import { useTranslation } from '@/lib/i18n';
import { indexText, useTableSearch } from '@/lib/table-search';
import { AlertTriangle, Check, Edit3, Loader2, Search, Trash2, X } from 'lucide-react';

interface Provider { id: string; name: string; }
interface ModelRow {
  id: string;
  publicModelId: string;
  providerModelId: string;
  displayName: string;
  description: string | null;
  contextLength: number;
  capabilities: string[];
  inputCreditsPer1m: number;
  outputCreditsPer1m: number;
  providerCostInputPer1m: number | null;
  providerCostOutputPer1m: number | null;
  status: string;
  /** Some provider on its route has a key (see lib/model-readiness) */
  ready: boolean;
  providerName: string;
  providerId?: string;
}

function Tip({ text }: { text: string }) {
  return (
    <span className="relative inline-flex items-center group ml-1.5">
      <button
        type="button"
        aria-label={`Info: ${text}`}
        tabIndex={0}
        className="w-3.5 h-3.5 rounded-full bg-neutral-200 text-neutral-600 text-[9px] font-bold flex items-center justify-center leading-none cursor-help hover:bg-neutral-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
      >
        ?
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute z-50 left-5 top-1/2 -translate-y-1/2 w-60 px-3 py-2 rounded-xl bg-neutral-950 text-white text-[11px] leading-relaxed opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-150 shadow-xl border border-neutral-800"
      >
        {text}
      </span>
    </span>
  );
}

function Field({ label, tip, children, span }: {
  label: string; tip?: string; children: React.ReactNode; span?: string;
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${span ?? ''}`}>
      <label className="flex items-center text-[11px] font-mono font-semibold uppercase tracking-wider text-neutral-500">
        {label}{tip && <Tip text={tip} />}
      </label>
      {children}
    </div>
  );
}

/** Inline edit row that replaces the table row when editing */
function EditRow({ model, providers, onDone }: {
  model: ModelRow;
  providers: Provider[];
  onDone: () => void;
}) {
  const { t } = useTranslation();

  return (
    <tr className="bg-neutral-50 border-y-2 border-neutral-950">
      <td colSpan={8} className="px-5 py-5">
        <div className="flex items-center justify-between mb-3 pb-2 border-b border-neutral-200">
          <div className="text-xs font-bold font-mono text-neutral-950 uppercase tracking-wider">
            {t.admin.models.editTitle}: {model.displayName} ({model.publicModelId})
          </div>
          <button
            type="button"
            onClick={onDone}
            className="p-1 rounded-lg text-neutral-500 hover:text-neutral-950 hover:bg-neutral-200 transition-colors cursor-pointer"
            aria-label="Cancel editing"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <form
          action={async (fd) => { await saveModel(fd); onDone(); }}
          className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-3"
        >
          {/* hidden id — triggers UPDATE in saveModel */}
          <input type="hidden" name="id" value={model.id} />

          <Field label="Provider" tip="Upstream provider serving this model.">
            <select
              name="providerId"
              aria-label="Provider"
              className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-white text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
              required
              defaultValue={model.providerId ?? ''}
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </Field>

          <Field label="Public Model ID" tip="ID that API clients send in requests (e.g. deepseek-v4).">
            <input
              name="publicModelId"
              aria-label="Public Model ID"
              className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-white text-neutral-900 font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
              defaultValue={model.publicModelId}
              required
            />
          </Field>

          <Field label="Provider Model ID" tip="Actual model ID forwarded to the upstream API (e.g. deepseek-chat).">
            <input
              name="providerModelId"
              aria-label="Provider Model ID"
              className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-white text-neutral-900 font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
              defaultValue={model.providerModelId}
              required
            />
          </Field>

          <Field label="Display Name" tip="Human-readable name shown in dashboard UI.">
            <input
              name="displayName"
              aria-label="Display Name"
              className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-white text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
              defaultValue={model.displayName}
              required
            />
          </Field>

          <Field label="Description" tip="Short description shown on model cards." span="col-span-2">
            <input
              name="description"
              aria-label="Description"
              className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-white text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
              defaultValue={model.description ?? ''}
            />
          </Field>

          <Field label="Capabilities" tip="Comma-separated: coding, reasoning, chat, multimodal, vision." span="col-span-2">
            <input
              name="capabilities"
              aria-label="Capabilities"
              className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-white text-neutral-900 font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
              defaultValue={model.capabilities.join(', ')}
            />
          </Field>

          <Field label="Context Length" tip="Max context window in tokens. ≥128K = Long Context badge.">
            <input
              name="contextLength"
              aria-label="Context Length"
              className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-white text-neutral-900 font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
              type="number"
              defaultValue={model.contextLength}
              min={1024}
              step={1024}
              required
            />
          </Field>

          <Field label="Input Credits / 1M" tip="Credits charged per 1M input (prompt) tokens.">
            <input
              name="inputCreditsPer1m"
              aria-label="Input Credits per 1M"
              className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-white text-neutral-900 font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
              type="number"
              defaultValue={model.inputCreditsPer1m}
              min={1}
              required
            />
          </Field>

          <Field label="Output Credits / 1M" tip="Credits charged per 1M output (completion) tokens.">
            <input
              name="outputCreditsPer1m"
              aria-label="Output Credits per 1M"
              className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-white text-neutral-900 font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
              type="number"
              defaultValue={model.outputCreditsPer1m}
              min={1}
              required
            />
          </Field>

          <Field label="Upstream cost in / 1M" tip="What the provider charges us per 1M input tokens, in credits. Leave blank if unknown.">
            <input
              name="providerCostInputPer1m"
              aria-label="Upstream input cost in credits per 1M"
              className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-white text-neutral-900 font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
              type="number"
              defaultValue={model.providerCostInputPer1m ?? ''}
              min={0}
            />
          </Field>

          <Field label="Upstream cost out / 1M" tip="What the provider charges us per 1M output tokens, in credits. Used for negative-margin alerts.">
            <input
              name="providerCostOutputPer1m"
              aria-label="Upstream output cost in credits per 1M"
              className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-white text-neutral-900 font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
              type="number"
              defaultValue={model.providerCostOutputPer1m ?? ''}
              min={0}
            />
          </Field>

          <Field label="Status" tip="active = available to users. inactive = hidden from API. deprecated = sunset.">
            <select
              name="status"
              aria-label="Status"
              className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-white text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
              defaultValue={model.status}
            >
              <option value="active">active</option>
              <option value="inactive">inactive</option>
              <option value="deprecated">deprecated</option>
            </select>
          </Field>

          <div className="col-span-full flex items-center gap-2 pt-2">
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl bg-neutral-950 text-white hover:bg-neutral-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 cursor-pointer shadow-xs"
            >
              <Check className="w-3.5 h-3.5" />
              {t.admin.models.saveBtn}
            </button>
            <button
              type="button"
              onClick={onDone}
              className="px-4 py-2 text-xs font-semibold rounded-xl border border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 cursor-pointer shadow-2xs"
            >
              {t.admin.models.cancelBtn}
            </button>
          </div>
        </form>
      </td>
    </tr>
  );
}

export function ModelsTable({ models, providers }: {
  models: (ModelRow & { providerId: string })[];
  providers: Provider[];
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedModelForDelete, setSelectedModelForDelete] = useState<(ModelRow & { providerId: string }) | null>(null);
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();
  const { t } = useTranslation();
  const search = useTableSearch(models, (m) =>
    indexText(
      m.publicModelId,
      m.providerModelId,
      m.displayName,
      m.providerName,
      m.status,
      m.status === 'active' ? (m.ready ? 'ready' : 'unready') : null,
      ...m.capabilities,
    ),
  );

  const handleDeleteModel = () => {
    if (!selectedModelForDelete) return;

    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set('id', selectedModelForDelete.id);
        const res = await deleteModel(fd);
        setToastMessage({ type: res.deleted ? 'success' : 'error', text: res.message });
        if (res.deleted) {
          setSelectedModelForDelete(null);
        }
      } catch (err: unknown) {
        setToastMessage({
          type: 'error',
          text: err instanceof Error ? err.message : 'Gagal menghapus model.',
        });
      }
    });
  };

  return (
    <>
      {/* Toast Alert */}
      {toastMessage && (
        <div
          className={`p-3.5 rounded-2xl text-xs flex items-center justify-between border shadow-2xs mb-4 ${
            toastMessage.type === 'success'
              ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
              : 'bg-red-50 text-red-900 border-red-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {toastMessage.type === 'success' ? (
              <Check className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            )}
            <span>{toastMessage.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setToastMessage(null)}
            className="text-neutral-500 hover:text-neutral-900 cursor-pointer text-xs font-semibold px-2 py-1"
          >
            ✕
          </button>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <label className="relative flex-1">
          <span className="sr-only">Cari model</span>
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-400" aria-hidden="true" />
          <input
            type="search"
            value={search.query}
            onChange={(e) => search.setQuery(e.target.value)}
            placeholder="Cari model, provider, status… misal: kimi chutes, unready, k2.6"
            className="w-full pl-9 pr-3 py-2.5 text-xs rounded-xl border border-neutral-200 bg-white font-mono text-neutral-900 placeholder:text-neutral-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
          />
        </label>
        <span className="text-[11px] font-mono text-neutral-500 shrink-0" aria-live="polite">
          {search.filtered.length} / {models.length} model
        </span>
      </div>

      {/* Table Card */}
      <div className={`bg-white rounded-2xl border border-neutral-200/90 shadow-xs overflow-hidden ${search.pending ? 'opacity-70' : ''}`}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-neutral-200/80 bg-neutral-50/50">
                <th className="text-left font-mono font-semibold uppercase tracking-wider text-neutral-500 py-3 px-4">{t.admin.models.thPublicId}</th>
                <th className="text-left font-mono font-semibold uppercase tracking-wider text-neutral-500 py-3 px-3">{t.admin.models.thProviderId}</th>
                <th className="text-left font-mono font-semibold uppercase tracking-wider text-neutral-500 py-3 px-3">{t.admin.models.thProvider}</th>
                <th className="text-left font-mono font-semibold uppercase tracking-wider text-neutral-500 py-3 px-3">{t.admin.models.thContext}</th>
                <th className="text-left font-mono font-semibold uppercase tracking-wider text-neutral-500 py-3 px-3">{t.admin.models.thRates}</th>
                <th className="text-left font-mono font-semibold uppercase tracking-wider text-neutral-500 py-3 px-3">{t.admin.models.thCapabilities}</th>
                <th className="text-left font-mono font-semibold uppercase tracking-wider text-neutral-500 py-3 px-3">{t.admin.models.thStatus}</th>
                <th className="text-right font-mono font-semibold uppercase tracking-wider text-neutral-500 py-3 px-4">{t.admin.models.thAction}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {search.filtered.map((m) =>
                editingId === m.id ? (
                  <EditRow
                    key={m.id}
                    model={m}
                    providers={providers}
                    onDone={() => setEditingId(null)}
                  />
                ) : (
                  <tr key={m.id} className="hover:bg-neutral-50/60 transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-mono font-semibold text-neutral-950">{m.publicModelId}</div>
                      <div className="text-[11px] text-neutral-500">{m.displayName}</div>
                    </td>
                    <td className="py-3 px-3 font-mono text-neutral-600 text-xs">{m.providerModelId}</td>
                    <td className="py-3 px-3 font-medium text-neutral-900">{m.providerName}</td>
                    <td className="py-3 px-3 font-mono text-neutral-600">{(m.contextLength / 1000).toFixed(0)}K</td>
                    <td className="py-3 px-3 font-mono text-neutral-900 font-semibold">{m.inputCreditsPer1m} / {m.outputCreditsPer1m}</td>
                    <td className="py-3 px-3 text-neutral-500 text-[11px]">
                      {Array.isArray(m.capabilities) && m.capabilities.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {m.capabilities.map((cap) => (
                            <span key={cap} className="px-1.5 py-0.5 rounded bg-neutral-100 text-neutral-700 font-mono text-[10px]">
                              {cap}
                            </span>
                          ))}
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap">
                      {m.status === 'active' && !m.ready ? (
                        <span
                          title="Belum ada provider dengan API key untuk model ini"
                          className="inline-flex items-center gap-1.5 font-mono text-[11px] font-medium text-amber-800"
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" aria-hidden="true" />
                          unready
                        </span>
                      ) : m.status === 'active' ? (
                        <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-medium text-neutral-700">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" aria-hidden="true" />
                          {t.admin.status.active}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-medium text-neutral-500">
                          <span className="w-1.5 h-1.5 rounded-full bg-neutral-400 shrink-0" aria-hidden="true" />
                          {m.status}
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => setEditingId(m.id)}
                          className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border border-neutral-200 bg-white hover:bg-neutral-100 text-neutral-900 font-medium transition-colors cursor-pointer shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
                        >
                          <Edit3 className="w-3 h-3" />
                          {t.admin.models.editBtn}
                        </button>
                        <button
                          type="button"
                          onClick={() => setSelectedModelForDelete(m)}
                          className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border border-red-200 bg-red-50/50 hover:bg-red-50 text-red-600 hover:text-red-700 font-medium transition-colors cursor-pointer shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                          aria-label={`${t.admin.models.deleteBtn} ${m.displayName}`}
                        >
                          <Trash2 className="w-3 h-3" />
                          {t.admin.models.deleteBtn}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              )}
              {search.filtered.length === 0 && search.query.trim() && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-neutral-500">
                    Tidak ada model yang cocok dengan &quot;{search.query.trim()}&quot;.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {selectedModelForDelete && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget && !isPending) setSelectedModelForDelete(null);
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs animate-in fade-in duration-150"
        >
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl border border-red-200 space-y-4 animate-in zoom-in-95 duration-150"
          >
            <div className="flex items-center gap-3 text-red-600">
              <div className="w-10 h-10 rounded-2xl bg-red-50 border border-red-200 flex items-center justify-center shrink-0">
                <AlertTriangle className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <h4 className="text-base font-bold text-neutral-950 font-heading">
                  {t.admin.models.deleteModelTitle || 'Hapus Model AI'}
                </h4>
                <p className="text-xs text-neutral-500 font-mono">
                  {selectedModelForDelete.displayName} ({selectedModelForDelete.publicModelId})
                </p>
              </div>
            </div>

            <div className="p-3.5 rounded-2xl bg-red-50/70 border border-red-200/80 text-xs text-red-900 leading-relaxed space-y-1.5">
              <p>
                {t.admin.models.confirmDelete || 'Apakah Anda yakin ingin menghapus model ini?'}
              </p>
              <ul className="list-disc list-inside text-[11px] text-red-800 space-y-0.5">
                <li>Model <strong>{selectedModelForDelete.publicModelId}</strong> {t.admin.models.deleteModelApiNotice}</li>
                <li>{t.admin.models.deleteModelWarning}</li>
              </ul>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setSelectedModelForDelete(null)}
                disabled={isPending}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-neutral-700 hover:bg-neutral-100 transition cursor-pointer"
              >
                {t.admin.models.cancelBtn}
              </button>
              <button
                type="button"
                onClick={handleDeleteModel}
                disabled={isPending}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition shadow-xs cursor-pointer disabled:opacity-50"
              >
                {isPending ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>{t.admin.models.processingBtn}</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>{t.admin.models.deleteBtn}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

