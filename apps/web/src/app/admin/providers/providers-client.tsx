'use client';

import { useState, useTransition } from 'react';
import { saveProvider, deleteProvider, toggleProviderStatus, fetchProviderCatalog } from '@/lib/admin-actions';
import type { CatalogResult } from '@/lib/provider-catalog';
import { CatalogTable } from './provider-catalog';
import { useTranslation } from '@/lib/i18n';
import { GATEWAY_PROVIDERS } from '@/lib/gateway-providers';
import {
  Activity,
  Server,
  Plus,
  Edit3,
  Trash2,
  X,
  Check,
  Power,
  Sparkles,
  ShieldCheck,
  AlertTriangle,
  Loader2,
  Search,
} from 'lucide-react';

export interface ProviderRow {
  id: string;
  name: string;
  baseUrl: string;
  encryptedCredentials: string | null;
  credentialReference: string | null;
  status: 'active' | 'disabled';
}

export interface ProviderStat {
  providerName: string;
  totalRequests: number;
  errorRequests: number;
}

interface ProvidersClientProps {
  initialProviders: ProviderRow[];
  stats: ProviderStat[];
}

const POPULAR_PRESETS = GATEWAY_PROVIDERS.map((p) => ({ name: p.key, label: p.label, baseUrl: p.baseUrl }));

export function ProvidersClient({ initialProviders, stats }: ProvidersClientProps) {
  const { t } = useTranslation();

  // Modal states: 'add' | 'edit' | 'delete' | null
  const [modalMode, setModalMode] = useState<'add' | 'edit' | 'delete' | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<ProviderRow | null>(null);

  // Form states
  const [formData, setFormData] = useState<{
    id: string;
    name: string;
    baseUrl: string;
    credential: string;
    status: 'active' | 'disabled';
  }>({
    id: '',
    name: '',
    baseUrl: '',
    credential: '',
    status: 'active',
  });

  const [isPending, startTransition] = useTransition();
  const [preview, setPreview] = useState<CatalogResult | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const handlePreview = async () => {
    setPreviewing(true);
    setPreview(
      await fetchProviderCatalog({
        providerId: formData.id || undefined,
        baseUrl: formData.baseUrl,
        credential: formData.credential,
      }),
    );
    setPreviewing(false);
  };
  const [toastMessage, setToastMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const statsMap = new Map(
    stats
      .filter((s) => Boolean(s.providerName))
      .map((s) => [s.providerName, s])
  );

  // Open "Tambah Provider" Modal
  const handleOpenAdd = () => {
    setSelectedProvider(null);
    setFormData({
      id: '',
      name: '',
      baseUrl: '',
      credential: '',
      status: 'active',
    });
    setToastMessage(null);
    setModalMode('add');
  };

  // Open "Edit Provider" Modal
  const handleOpenEdit = (provider: ProviderRow) => {
    setSelectedProvider(provider);
    setFormData({
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      credential: '',
      status: provider.status,
    });
    setToastMessage(null);
    setModalMode('edit');
  };

  // Open "Delete Provider" Modal
  const handleOpenDelete = (provider: ProviderRow) => {
    setSelectedProvider(provider);
    setToastMessage(null);
    setModalMode('delete');
  };

  const closeModal = () => {
    setModalMode(null);
    setPreview(null);
    setSelectedProvider(null);
  };

  const handleSelectPreset = (preset: (typeof POPULAR_PRESETS)[0]) => {
    setFormData((prev) => ({
      ...prev,
      name: preset.name,
      baseUrl: preset.baseUrl,
    }));
  };

  // Submit Add or Edit
  const handleSubmitForm = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const fd = new FormData();
    if (formData.id) fd.set('id', formData.id);
    fd.set('name', formData.name);
    fd.set('baseUrl', formData.baseUrl);
    if (formData.credential) fd.set('credential', formData.credential);
    fd.set('status', formData.status);

    startTransition(async () => {
      try {
        await saveProvider(fd);
        setToastMessage({
          type: 'success',
          text: modalMode === 'edit'
            ? `Provider "${formData.name}" berhasil diperbarui!`
            : `Provider "${formData.name}" berhasil ditambahkan!`,
        });
        closeModal();
      } catch (err: any) {
        setToastMessage({
          type: 'error',
          text: err?.message || 'Gagal menyimpan provider.',
        });
      }
    });
  };

  // Confirm Delete
  const handleConfirmDelete = () => {
    if (!selectedProvider) return;

    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set('id', selectedProvider.id);
        const res = await deleteProvider(fd);
        setToastMessage({ type: res.deleted ? 'success' : 'error', text: res.message });
        closeModal();
      } catch (err: any) {
        setToastMessage({
          type: 'error',
          text: err?.message || 'Gagal menghapus provider.',
        });
      }
    });
  };

  // Toggle active/disabled
  const handleToggle = (provider: ProviderRow) => {
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set('id', provider.id);
        await toggleProviderStatus(fd);
        setToastMessage({
          type: 'success',
          text: `Status ${provider.name} diubah menjadi ${provider.status === 'active' ? 'Disabled' : 'Active'}.`,
        });
      } catch (err: any) {
        setToastMessage({
          type: 'error',
          text: err?.message || 'Gagal mengubah status provider.',
        });
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* Toast Feedback */}
      {toastMessage && (
        <div
          className={`px-4 py-3 rounded-2xl text-xs flex items-center justify-between shadow-xs animate-in fade-in duration-200 ${
            toastMessage.type === 'success'
              ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
              : 'bg-red-50 text-red-900 border border-red-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {toastMessage.type === 'success' ? (
              <Check className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            )}
            <span className="font-medium">{toastMessage.text}</span>
          </div>
          <button
            type="button"
            onClick={() => setToastMessage(null)}
            className="p-1 rounded-lg hover:bg-black/5 text-neutral-500 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Action Bar (Top Button) */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-white p-4 rounded-2xl border border-neutral-200/90 shadow-xs">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-neutral-100 flex items-center justify-center text-neutral-800 shrink-0">
            <Server className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-sm font-bold font-heading text-neutral-950">
              Manajemen Upstream Provider
            </h2>
            <p className="text-xs text-neutral-500">
              Total {initialProviders.length} gateway provider terdaftar di Morphic.
            </p>
          </div>
        </div>

        {/* PENCET TAMBAH PROVIDER BUTTON */}
        <button
          type="button"
          onClick={handleOpenAdd}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-neutral-950 hover:bg-neutral-800 text-white text-xs font-bold transition shadow-xs cursor-pointer shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span>+ Tambah Provider</span>
        </button>
      </div>

      {/* 5-Min Live Health Card */}
      <div className="bg-white p-6 rounded-2xl border border-neutral-200/90 shadow-xs">
        <div className="text-xs font-mono uppercase tracking-wider text-neutral-500 mb-4 flex items-center justify-between pb-3 border-b border-neutral-100">
          <span className="flex items-center gap-2 font-bold text-neutral-900">
            <Activity className="w-4 h-4 text-neutral-700" />
            {t.admin.providers.monitorTitle}
          </span>
          <span className="text-[11px] text-neutral-500 normal-case font-sans">
            {t.admin.providers.autoAlertThreshold}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
          {initialProviders.map((p) => {
            const stat = statsMap.get(p.name);
            const total = stat?.totalRequests ?? 0;
            const errors = stat?.errorRequests ?? 0;
            const rate = total > 0 ? (errors / total) * 100 : 0;
            const isAlerting = total >= 5 && rate >= 50;
            const isDegraded = total >= 5 && rate >= 20;

            return (
              <div
                key={p.id}
                className="p-4 rounded-xl border border-neutral-200/90 bg-neutral-50/40 flex flex-col justify-between gap-3"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-neutral-950 font-heading">{p.name}</span>
                  {isAlerting ? (
                    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-bold text-red-600">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" aria-hidden="true" />
                      {t.admin.status.tripped}
                    </span>
                  ) : isDegraded ? (
                    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-bold text-amber-700">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" aria-hidden="true" />
                      {t.admin.status.degraded}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-medium text-neutral-700">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" aria-hidden="true" />
                      {t.admin.status.healthy}
                    </span>
                  )}
                </div>
                <div className="text-xs text-neutral-600 font-mono">
                  Error Rate:{' '}
                  <span className={`font-bold ${isAlerting ? 'text-red-600' : 'text-neutral-950'}`}>
                    {rate.toFixed(1)}%
                  </span>{' '}
                  <span className="text-[11px] text-neutral-500">
                    ({errors}/{total} reqs in 5m)
                  </span>
                </div>
              </div>
            );
          })}
          {initialProviders.length === 0 && (
            <div className="col-span-full py-4 text-center text-xs text-neutral-500 font-mono">
              Belum ada provider yang terdaftar.
            </div>
          )}
        </div>
      </div>

      {/* Providers Table Card */}
      <div className="bg-white rounded-2xl border border-neutral-200/90 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-neutral-200/80 bg-neutral-50/50">
                <th className="text-left font-mono font-semibold uppercase tracking-wider text-neutral-500 py-3.5 px-4">
                  {t.admin.providers.thName}
                </th>
                <th className="text-left font-mono font-semibold uppercase tracking-wider text-neutral-500 py-3.5 px-3">
                  {t.admin.providers.thBaseUrl}
                </th>
                <th className="text-left font-mono font-semibold uppercase tracking-wider text-neutral-500 py-3.5 px-3">
                  {t.admin.providers.thCredential}
                </th>
                <th className="text-left font-mono font-semibold uppercase tracking-wider text-neutral-500 py-3.5 px-4">
                  {t.admin.providers.thStatus}
                </th>
                <th className="text-right font-mono font-semibold uppercase tracking-wider text-neutral-500 py-3.5 px-4">
                  Aksi Admin
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {initialProviders.map((p) => (
                <tr key={p.id} className="hover:bg-neutral-50/60 transition-colors">
                  <td className="py-3 px-4 font-semibold text-neutral-950">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 rounded-md bg-neutral-100 flex items-center justify-center text-neutral-600 shrink-0">
                        <Server className="w-3.5 h-3.5" />
                      </div>
                      <span className="font-heading font-bold text-neutral-900">{p.name}</span>
                    </div>
                  </td>
                  <td className="py-3 px-3 font-mono text-neutral-600 text-xs">
                    <span className="truncate max-w-xs block select-all">{p.baseUrl}</span>
                  </td>
                  <td className="py-3 px-3 font-mono text-xs text-neutral-500">
                    {p.encryptedCredentials ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200/60">
                        <Check className="w-3 h-3" />
                        <span>terenkripsi</span>
                      </span>
                    ) : (
                      p.credentialReference ?? '—'
                    )}
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => handleToggle(p)}
                      disabled={isPending}
                      title="Klik untuk mengubah status"
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-mono text-[11px] font-semibold border transition cursor-pointer ${
                        p.status === 'active'
                          ? 'bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-100'
                          : 'bg-neutral-100 text-neutral-600 border-neutral-200 hover:bg-neutral-200'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          p.status === 'active' ? 'bg-emerald-500' : 'bg-neutral-400'
                        }`}
                      />
                      <span>{p.status === 'active' ? 'Aktif' : 'Nonaktif'}</span>
                    </button>
                  </td>
                  <td className="py-3 px-4 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-2">
                      {/* PENCET EDIT PROVIDER BUTTON */}
                      <button
                        type="button"
                        onClick={() => handleOpenEdit(p)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-neutral-200 bg-white hover:bg-neutral-100 text-neutral-800 text-xs font-semibold transition cursor-pointer shadow-2xs"
                      >
                        <Edit3 className="w-3.5 h-3.5 text-neutral-600" />
                        <span>Edit</span>
                      </button>

                      {/* PENCET DELETE PROVIDER BUTTON */}
                      <button
                        type="button"
                        onClick={() => handleOpenDelete(p)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-red-200 bg-red-50/50 hover:bg-red-100 text-red-700 text-xs font-semibold transition cursor-pointer shadow-2xs"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-red-600" />
                        <span>Hapus</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {initialProviders.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-10 text-center text-xs text-neutral-500 font-mono">
                    Belum ada provider terdaftar. Klik tombol &quot;+ Tambah Provider&quot; di atas untuk menambahkan.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          MODAL: TAMBAH / EDIT PROVIDER
         ───────────────────────────────────────────────────────────── */}
      {(modalMode === 'add' || modalMode === 'edit') && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget && !isPending) closeModal();
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs animate-in fade-in duration-150"
        >
          <div
            role="dialog"
            aria-modal="true"
            className={`w-full ${preview?.ok ? 'max-w-3xl' : 'max-w-lg'} rounded-3xl bg-white p-6 shadow-2xl border border-neutral-200 space-y-4 animate-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto`}
          >
            <div className="flex items-center justify-between pb-3 border-b border-neutral-100">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-neutral-100 flex items-center justify-center text-neutral-800">
                  {modalMode === 'edit' ? <Edit3 className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                </div>
                <div>
                  <h3 className="text-base font-bold text-neutral-950 font-heading">
                    {modalMode === 'edit' ? `Edit Provider: ${formData.name}` : 'Tambah Upstream Provider'}
                  </h3>
                  <p className="text-xs text-neutral-500">
                    {modalMode === 'edit'
                      ? 'Perbarui konfigurasi gateway endpoint dan kredensial.'
                      : 'Hubungkan penyedia AI baru ke Morphic Gateway.'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeModal}
                disabled={isPending}
                className="p-1 rounded-xl text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Quick Presets (only when adding new) */}
            {modalMode === 'add' && (
              <div className="p-3 rounded-2xl bg-neutral-50 border border-neutral-200/70 space-y-2">
                <div className="flex items-center gap-1.5 text-[11px] font-mono font-bold uppercase tracking-wider text-neutral-500">
                  <Sparkles className="w-3.5 h-3.5 text-neutral-700" />
                  <span>Preset Cepat (Klik untuk Isi Otomatis)</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {POPULAR_PRESETS.map((p) => (
                    <button
                      key={p.name}
                      type="button"
                      onClick={() => handleSelectPreset(p)}
                      className={`px-2.5 py-1 text-xs font-semibold rounded-lg border transition-all cursor-pointer ${
                        formData.name === p.name
                          ? 'bg-neutral-950 text-white border-neutral-950 shadow-2xs'
                          : 'bg-white hover:bg-neutral-100 text-neutral-700 border-neutral-200'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleSubmitForm} className="space-y-3.5">
              <div>
                <label className="block text-[11px] font-mono font-semibold uppercase tracking-wider text-neutral-600 mb-1">
                  Nama Provider <span className="text-red-500">*</span>
                </label>
                <input
                  name="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="misal: deepseek, groq, openai"
                  required
                  className="w-full px-3.5 py-2 text-xs rounded-xl border border-neutral-200 bg-neutral-50 text-neutral-950 placeholder:text-neutral-400 font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
                />
              </div>

              <div>
                <label className="block text-[11px] font-mono font-semibold uppercase tracking-wider text-neutral-600 mb-1">
                  Base URL Endpoint <span className="text-red-500">*</span>
                </label>
                <input
                  name="baseUrl"
                  value={formData.baseUrl}
                  onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
                  placeholder="https://api.provider.com/v1"
                  required
                  className="w-full px-3.5 py-2 text-xs rounded-xl border border-neutral-200 bg-neutral-50 text-neutral-950 placeholder:text-neutral-400 font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
                />
              </div>

              <div>
                <label className="block text-[11px] font-mono font-semibold uppercase tracking-wider text-neutral-600 mb-1">
                  API Key / Kredensial
                </label>
                <input
                  name="credential"
                  type="password"
                  value={formData.credential}
                  onChange={(e) => setFormData({ ...formData, credential: e.target.value })}
                  placeholder={
                    modalMode === 'edit'
                      ? 'Kosongkan jika tetap memakai kredensial tersimpan'
                      : 'API Key (misal: sk-...) opsional jika proxy lokal'
                  }
                  className="w-full px-3.5 py-2 text-xs rounded-xl border border-neutral-200 bg-neutral-50 text-neutral-950 placeholder:text-neutral-400 font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
                />
                <div className="flex items-center gap-1.5 text-[11px] text-neutral-500 mt-1.5 font-mono">
                  <ShieldCheck className="w-3.5 h-3.5 text-neutral-600 shrink-0" />
                  <span>Dienkripsi AES-256-GCM secara otomatis sebelum disimpan.</span>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-mono font-semibold uppercase tracking-wider text-neutral-600 mb-1">
                  Status Gateway
                </label>
                <select
                  name="status"
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value as 'active' | 'disabled' })}
                  className="w-full px-3.5 py-2 text-xs rounded-xl border border-neutral-200 bg-neutral-50 text-neutral-950 font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
                >
                  <option value="active">Active (Rute Aktif)</option>
                  <option value="disabled">Disabled (Nonaktif)</option>
                </select>
              </div>

              <div className="space-y-3">
                <button
                  type="button"
                  onClick={handlePreview}
                  disabled={previewing || !formData.baseUrl}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-neutral-200 bg-white hover:bg-neutral-100 text-xs font-semibold disabled:opacity-50 cursor-pointer"
                >
                  {previewing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                  <span>Cek model &amp; harga</span>
                </button>
                {preview && !preview.ok && (
                  <p className="text-[11px] font-mono text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3 break-all">
                    {preview.error}
                  </p>
                )}
                {preview?.ok && (
                  <CatalogTable rows={preview.models.map((m) => ({ ...m, provider: formData.name }))} showProvider={false} />
                )}
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-neutral-100">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={isPending}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-neutral-700 hover:bg-neutral-100 transition cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isPending}
                  className="inline-flex items-center justify-center gap-1.5 px-5 py-2 rounded-xl bg-neutral-950 hover:bg-neutral-800 text-white text-xs font-bold transition shadow-xs cursor-pointer disabled:opacity-50"
                >
                  {isPending ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Menyimpan...</span>
                    </>
                  ) : modalMode === 'edit' ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>Simpan Perubahan</span>
                    </>
                  ) : (
                    <>
                      <Plus className="w-3.5 h-3.5" />
                      <span>Simpan Provider</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          MODAL: KONFIRMASI HAPUS PROVIDER
         ───────────────────────────────────────────────────────────── */}
      {modalMode === 'delete' && selectedProvider && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget && !isPending) closeModal();
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
                  Hapus Provider: {selectedProvider.name}
                </h4>
                <p className="text-xs text-neutral-500">{selectedProvider.baseUrl}</p>
              </div>
            </div>

            <p className="text-xs text-neutral-600 leading-relaxed">
              Apakah Anda yakin ingin menghapus provider <strong className="text-neutral-900">{selectedProvider.name}</strong>?
              Semua model provider ini ikut terhapus. Riwayat billing dan usage tetap tersimpan, hanya tidak lagi terhubung ke model.
            </p>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={closeModal}
                disabled={isPending}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-neutral-700 hover:bg-neutral-100 transition cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={isPending}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition shadow-xs cursor-pointer disabled:opacity-50"
              >
                {isPending ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Menghapus...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Hapus Permanen</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
