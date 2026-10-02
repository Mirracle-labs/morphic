import { eq } from 'drizzle-orm';
import { db, schema as s } from '@morphic/db';
import { requireAdmin } from '@/lib/actions';
import { saveModel } from '@/lib/admin-actions';
import { getServerTranslation } from '@/lib/i18n/server';
import { ModelsTable } from './models-table';
import { Cpu, Plus } from 'lucide-react';

/** Inline tooltip — accessible via hover and keyboard focus */
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
        className="
          pointer-events-none absolute z-50 left-5 top-1/2 -translate-y-1/2
          w-60 px-3 py-2 rounded-xl
          bg-neutral-950 text-white text-[11px] leading-relaxed
          opacity-0 group-hover:opacity-100 group-focus-within:opacity-100
          transition-opacity duration-150
          shadow-xl border border-neutral-800
        "
      >
        {text}
      </span>
    </span>
  );
}

/** Label + optional tooltip wrapper */
function Field({
  label,
  tip,
  children,
  span,
}: {
  label: string;
  tip?: string;
  children: React.ReactNode;
  span?: 'col-span-2' | 'col-span-full';
}) {
  return (
    <div className={`flex flex-col gap-1.5 ${span ?? ''}`}>
      <label className="flex items-center text-[11px] font-mono font-semibold uppercase tracking-wider text-neutral-500">
        {label}
        {tip && <Tip text={tip} />}
      </label>
      {children}
    </div>
  );
}

export default async function AdminModels() {
  await requireAdmin();
  const { t } = await getServerTranslation();

  const [models, providers] = await Promise.all([
    db
      .select({
        id: s.models.id,
        providerId: s.models.providerId,
        publicModelId: s.models.publicModelId,
        providerModelId: s.models.providerModelId,
        displayName: s.models.displayName,
        description: s.models.description,
        contextLength: s.models.contextLength,
        capabilities: s.models.capabilities,
        inputCreditsPer1m: s.models.inputCreditsPer1m,
        outputCreditsPer1m: s.models.outputCreditsPer1m,
        status: s.models.status,
        providerName: s.providers.name,
      })
      .from(s.models)
      .innerJoin(s.providers, eq(s.models.providerId, s.providers.id)),
    db.select().from(s.providers),
  ]);

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-5 border-b border-neutral-200/80">
        <div>
          <h1 className="text-xl sm:text-2xl font-heading font-extrabold tracking-tight text-neutral-950 flex items-center gap-2">
            <Cpu className="w-5 h-5 text-neutral-700" />
            {t.admin.models.title}
          </h1>
          <p className="text-xs sm:text-sm text-neutral-500 mt-0.5">
            {t.admin.models.desc}
          </p>
        </div>
      </div>

      {/* Add Model Card */}
      <div className="bg-white p-6 rounded-2xl border border-neutral-200/90 shadow-xs">
        <div className="flex items-center gap-2 mb-4 pb-3 border-b border-neutral-100">
          <Plus className="w-4 h-4 text-neutral-700" />
          <h2 className="text-sm font-heading font-bold text-neutral-950">{t.admin.models.addTitle}</h2>
        </div>
        <form action={saveModel} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-4">
          {/* Row 1 */}
          <Field
            label="Provider"
            tip="Upstream provider that serves this model. Must be registered in the Providers table first."
          >
            <select
              name="providerId"
              aria-label="Provider"
              className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-neutral-50 text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
              required
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </Field>

          <Field
            label="Public Model ID"
            tip="The model ID that external clients send in requests (e.g. deepseek-v4). This is what users put in their SDK config."
          >
            <input
              name="publicModelId"
              aria-label="Public Model ID"
              className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-neutral-50 text-neutral-900 placeholder:text-neutral-500 font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
              placeholder="deepseek-v4"
              required
            />
          </Field>

          <Field
            label="Provider Model ID"
            tip="The actual model ID forwarded to upstream API (e.g. deepseek-chat). Check provider documentation."
          >
            <input
              name="providerModelId"
              aria-label="Provider Model ID"
              className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-neutral-50 text-neutral-900 placeholder:text-neutral-500 font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
              placeholder="deepseek-chat"
              required
            />
          </Field>

          <Field
            label="Display Name"
            tip="Human-readable name shown in dashboard UI and model picker."
          >
            <input
              name="displayName"
              aria-label="Display Name"
              className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-neutral-50 text-neutral-900 placeholder:text-neutral-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
              placeholder="DeepSeek V4"
              required
            />
          </Field>

          {/* Row 2 */}
          <Field
            label="Description"
            tip="Short description of what this model is good for."
            span="col-span-2"
          >
            <input
              name="description"
              aria-label="Description"
              className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-neutral-50 text-neutral-900 placeholder:text-neutral-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
              placeholder="Fast and affordable coding model by DeepSeek"
            />
          </Field>

          <Field
            label="Capabilities"
            tip="Comma-separated: coding, reasoning, chat, multimodal, vision."
            span="col-span-2"
          >
            <input
              name="capabilities"
              aria-label="Capabilities"
              className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-neutral-50 text-neutral-900 placeholder:text-neutral-500 font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
              placeholder="coding, reasoning"
            />
          </Field>

          {/* Row 3 */}
          <Field
            label="Context Length (tokens)"
            tip="Maximum context window in tokens. ≥128K = Long Context badge."
          >
            <input
              name="contextLength"
              aria-label="Context Length in tokens"
              className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-neutral-50 text-neutral-900 placeholder:text-neutral-500 font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
              type="number"
              placeholder="65536"
              min={1024}
              step={1024}
              required
            />
          </Field>

          <Field
            label="Input Credits / 1M"
            tip="Credits charged per 1 million input (prompt) tokens."
          >
            <input
              name="inputCreditsPer1m"
              aria-label="Input credits per 1 million tokens"
              className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-neutral-50 text-neutral-900 placeholder:text-neutral-500 font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
              type="number"
              placeholder="100"
              min={1}
              required
            />
          </Field>

          <Field
            label="Output Credits / 1M"
            tip="Credits charged per 1 million output (completion) tokens."
          >
            <input
              name="outputCreditsPer1m"
              aria-label="Output credits per 1 million tokens"
              className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-neutral-50 text-neutral-900 placeholder:text-neutral-500 font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
              type="number"
              placeholder="300"
              min={1}
              required
            />
          </Field>

          <div className="flex items-end">
            <button
              type="submit"
              className="w-full px-4 py-2 text-xs font-semibold rounded-xl bg-neutral-950 text-white hover:bg-neutral-800 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 cursor-pointer shadow-xs"
            >
              {t.admin.models.createBtn}
            </button>
          </div>
        </form>
      </div>

      {/* Model Table Card */}
      <div className="bg-white rounded-2xl border border-neutral-200/90 shadow-xs overflow-hidden">
        <ModelsTable models={models} providers={providers} />
      </div>
    </div>
  );
}
