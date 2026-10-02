'use client';

import { useState } from 'react';
import { saveModel } from '@/lib/admin-actions';
import { useTranslation } from '@/lib/i18n';
import { Check, Edit3, X } from 'lucide-react';

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
  status: string;
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
  const { t } = useTranslation();

  return (
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
          {models.map((m) =>
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
                  {m.status === 'active' ? (
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
                  <button
                    type="button"
                    onClick={() => setEditingId(m.id)}
                    className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border border-neutral-200 bg-white hover:bg-neutral-100 text-neutral-900 font-medium transition-colors cursor-pointer shadow-2xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
                  >
                    <Edit3 className="w-3 h-3" />
                    {t.admin.models.editBtn}
                  </button>
                </td>
              </tr>
            )
          )}
        </tbody>
      </table>
    </div>
  );
}
