'use client';

import { useRef, useState, useTransition } from 'react';
import { savePackage, deletePackage } from '@/lib/admin-actions';
import { useTranslation } from '@/lib/i18n';
import { formatCredits } from '@/lib/utils';
import { AlertTriangle, Check, Edit3, Loader2, Plus, Trash2, X } from 'lucide-react';

export interface PackageRow {
  id: string;
  name: string;
  description: string | null;
  kind: 'balance' | 'tokens' | 'unlimited';
  creditAllowance: number;
  modelId: string | null;
  durationHours: number | null;
  priceCents: number | null;
  currency: string;
  status: 'active' | 'inactive';
  /** Users holding a still-active entitlement from this package. */
  activeHolders: number;
  pendingPayments: number;
  activeCodes: number;
}

type Model = { id: string; displayName: string };

const input =
  'w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-neutral-50 text-neutral-900 placeholder:text-neutral-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950';
const label = 'block text-[11px] font-mono font-semibold uppercase tracking-wider text-neutral-500 mb-1';

const price = (p: Pick<PackageRow, 'priceCents' | 'currency'>) =>
  p.priceCents === null ? '—' : p.currency === 'USD' ? `$${(p.priceCents / 100).toFixed(2)}` : `Rp${p.priceCents.toLocaleString('id-ID')}`;

function PackageFields({ pkg, models, en, withStatus }: { pkg?: PackageRow; models: Model[]; en: boolean; withStatus?: boolean }) {
  const p = pkg ? `edit-${pkg.id}` : 'new';
  const usd = pkg?.currency === 'USD';
  return (
    <>
      <div>
        <label htmlFor={`${p}-name`} className={label}>{en ? 'Name' : 'Nama'}</label>
        <input id={`${p}-name`} name="name" defaultValue={pkg?.name} required maxLength={100} placeholder="DeepSeek V4 - 1 Day" className={input} />
      </div>
      <div>
        <label htmlFor={`${p}-desc`} className={label}>{en ? 'Description' : 'Deskripsi'}</label>
        <input id={`${p}-desc`} name="description" defaultValue={pkg?.description ?? ''} placeholder="Unlimited for 24 hours (fair use)" className={input} />
      </div>
      <div>
        <label htmlFor={`${p}-kind`} className={label}>{en ? 'Type' : 'Jenis'}</label>
        <select id={`${p}-kind`} name="kind" defaultValue={pkg?.kind ?? 'tokens'} className={input}>
          <option value="tokens">{en ? 'Token pack (all models, multiplier applies, 30 days)' : 'Paket token (semua model, pakai multiplier, 30 hari)'}</option>
          <option value="balance">{en ? 'Balance top-up (wallet, no expiry)' : 'Top-up balance (saldo, tanpa kedaluwarsa)'}</option>
          <option value="unlimited">{en ? 'Unlimited pass (one model, daily fair-use tokens)' : 'Unlimited (satu model, kuota fair use per hari)'}</option>
        </select>
      </div>
      <div>
        <label htmlFor={`${p}-model`} className={label}>{en ? 'Model (unlimited only)' : 'Model (khusus unlimited)'}</label>
        <select id={`${p}-model`} name="modelId" defaultValue={pkg?.modelId ?? ''} className={input}>
          <option value="">{en ? 'All models' : 'Semua model'}</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>{m.displayName}</option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`${p}-allowance`} className={label}>{en ? 'Tokens (unlimited: per day)' : 'Jumlah token (unlimited: per hari)'}</label>
        <input id={`${p}-allowance`} name="creditAllowance" type="number" min={1} step={1} defaultValue={pkg?.creditAllowance} required placeholder="10000000" className={`${input} font-mono`} />
      </div>
      <div>
        <label htmlFor={`${p}-duration`} className={label}>{en ? 'Duration (hours)' : 'Durasi (jam)'}</label>
        <input id={`${p}-duration`} name="durationHours" type="number" min={1} step={1} defaultValue={pkg?.durationHours ?? ''} placeholder={en ? 'empty = no expiry' : 'kosong = tanpa batas'} className={`${input} font-mono`} />
      </div>
      <div>
        <label htmlFor={`${p}-price`} className={label}>
          {en ? 'Price' : 'Harga'} ({usd ? 'USD cents' : 'IDR'})
        </label>
        <input id={`${p}-price`} name="priceCents" type="number" min={0} step={1} defaultValue={pkg?.priceCents ?? ''} placeholder={usd ? '500' : '25000'} className={`${input} font-mono`} />
      </div>
      {withStatus && (
        <div>
          <label htmlFor={`${p}-status`} className={label}>Status</label>
          <select id={`${p}-status`} name="status" defaultValue={pkg?.status ?? 'active'} className={input}>
            <option value="active">{en ? 'Active (users can buy it)' : 'Active (bisa dibeli user)'}</option>
            <option value="inactive">{en ? 'Inactive (hidden from users)' : 'Inactive (disembunyikan dari user)'}</option>
          </select>
        </div>
      )}
    </>
  );
}

export function PackagesClient({ packages, models }: { packages: PackageRow[]; models: Model[] }) {
  const { locale } = useTranslation();
  const en = locale === 'en';
  const [isPending, startTransition] = useTransition();
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState<PackageRow | null>(null);
  const [deleting, setDeleting] = useState<PackageRow | null>(null);
  const createRef = useRef<HTMLFormElement>(null);
  const modelName = (id: string | null) =>
    models.find((m) => m.id === id)?.displayName ?? (en ? 'All models (credit pack)' : 'Semua model (paket kredit)');

  const run = (action: () => Promise<{ ok: boolean; message: string }>, onOk?: () => void) =>
    startTransition(async () => {
      try {
        const res = await action();
        setToast({ ok: res.ok, text: res.message });
        if (res.ok) onOk?.();
      } catch {
        setToast({ ok: false, text: en ? 'Request failed. Try again.' : 'Gagal. Coba lagi.' });
      }
    });

  const close = () => {
    if (isPending) return;
    setEditing(null);
    setDeleting(null);
  };

  return (
    <div className="space-y-6">
      {toast && (
        <div
          role="status"
          className={`p-3.5 rounded-2xl text-xs flex items-center justify-between gap-3 border shadow-2xs ${
            toast.ok ? 'bg-emerald-50 text-emerald-900 border-emerald-200' : 'bg-red-50 text-red-900 border-red-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {toast.ok ? <Check className="w-4 h-4 text-emerald-600 shrink-0" /> : <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />}
            <span>{toast.text}</span>
          </div>
          <button type="button" onClick={() => setToast(null)} aria-label={en ? 'Dismiss' : 'Tutup'} className="p-1 text-neutral-500 hover:text-neutral-900 cursor-pointer">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Create */}
      <div className="bg-white p-6 rounded-2xl border border-neutral-200/90 shadow-xs">
        <div className="flex items-center gap-2 mb-4 pb-3 border-b border-neutral-100">
          <Plus className="w-4 h-4 text-neutral-700" />
          <h2 className="text-sm font-heading font-bold text-neutral-950">{en ? 'Create package' : 'Buat paket'}</h2>
        </div>
        <form
          ref={createRef}
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            run(() => savePackage(fd), () => createRef.current?.reset());
          }}
          className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3"
        >
          <PackageFields models={models} en={en} />
          <div className="sm:col-span-2 md:col-span-3 flex justify-end">
            <button type="submit" disabled={isPending} className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-xl bg-neutral-950 text-white hover:bg-neutral-800 disabled:opacity-50 cursor-pointer">
              {isPending && !editing && !deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
              {en ? 'Create' : 'Buat'}
            </button>
          </div>
        </form>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-neutral-200/90 shadow-xs overflow-hidden">
        {packages.length === 0 ? (
          <div className="p-8 text-center text-xs text-neutral-500">{en ? 'No packages yet.' : 'Belum ada paket.'}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-neutral-200/80 bg-neutral-50/50 text-neutral-500 font-mono uppercase tracking-wider">
                  <th className="text-left font-semibold py-3 px-4">{en ? 'Name' : 'Nama'}</th>
                  <th className="text-left font-semibold py-3 px-3">Model</th>
                  <th className="text-right font-semibold py-3 px-3">{en ? 'Credits' : 'Kredit'}</th>
                  <th className="text-left font-semibold py-3 px-3">{en ? 'Duration' : 'Durasi'}</th>
                  <th className="text-right font-semibold py-3 px-3">{en ? 'Price' : 'Harga'}</th>
                  <th className="text-left font-semibold py-3 px-3">Status</th>
                  <th className="text-right font-semibold py-3 px-4">{en ? 'Actions' : 'Aksi'}</th>
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
                    <td className="py-3 px-3 text-right font-mono font-semibold text-neutral-950">{price(p)}</td>
                    <td className="py-3 px-3 whitespace-nowrap">
                      <span className={`inline-flex items-center gap-1.5 font-mono text-[11px] font-medium ${p.status === 'active' ? 'text-neutral-700' : 'text-neutral-500'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${p.status === 'active' ? 'bg-emerald-500' : 'bg-neutral-400'}`} aria-hidden="true" />
                        {p.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex gap-2">
                        <button
                          type="button"
                          onClick={() => setEditing(p)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-neutral-200 bg-white hover:bg-neutral-100 text-neutral-800 font-semibold cursor-pointer"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleting(p)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-red-200 bg-red-50/50 hover:bg-red-100 text-red-700 font-semibold cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          {en ? 'Delete' : 'Hapus'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit modal */}
      {editing && (
        <div onClick={(e) => e.target === e.currentTarget && close()} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="edit-pkg-title" className="w-full max-w-2xl rounded-3xl bg-white p-6 shadow-2xl border border-neutral-200 space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-3 border-b border-neutral-100">
              <h3 id="edit-pkg-title" className="text-base font-bold text-neutral-950 font-heading">Edit: {editing.name}</h3>
              <button type="button" onClick={close} aria-label={en ? 'Close' : 'Tutup'} className="p-1 rounded-xl text-neutral-400 hover:text-neutral-700 hover:bg-neutral-100 cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            {editing.activeHolders > 0 && (
              <p className="text-[11px] text-neutral-600 bg-neutral-50 border border-neutral-200 rounded-xl p-3">
                {en
                  ? `${editing.activeHolders} user(s) hold an active pass from this package. Changes apply to new purchases and redemptions only; existing passes keep their credits and expiry.`
                  : `${editing.activeHolders} user punya pass aktif dari paket ini. Perubahan hanya berlaku untuk pembelian dan redeem berikutnya; pass yang sudah ada tetap dengan kredit dan masa berlakunya.`}
              </p>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                fd.set('id', editing.id);
                run(() => savePackage(fd), () => setEditing(null));
              }}
              className="grid grid-cols-1 sm:grid-cols-2 gap-3"
            >
              <PackageFields key={editing.id} pkg={editing} models={models} en={en} withStatus />
              <div className="sm:col-span-2 flex justify-end gap-2 pt-3 border-t border-neutral-100">
                <button type="button" onClick={close} disabled={isPending} className="px-4 py-2 rounded-xl text-xs font-semibold text-neutral-700 hover:bg-neutral-100 cursor-pointer">
                  {en ? 'Cancel' : 'Batal'}
                </button>
                <button type="submit" disabled={isPending} className="inline-flex items-center gap-1.5 px-5 py-2 rounded-xl bg-neutral-950 hover:bg-neutral-800 text-white text-xs font-bold disabled:opacity-50 cursor-pointer">
                  {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  {en ? 'Save changes' : 'Simpan perubahan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete modal */}
      {deleting && (
        <div onClick={(e) => e.target === e.currentTarget && close()} className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div role="alertdialog" aria-modal="true" aria-labelledby="del-pkg-title" className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl border border-neutral-200 space-y-4">
            <h3 id="del-pkg-title" className="flex items-center gap-2 text-base font-bold text-neutral-950 font-heading">
              <Trash2 className="w-4 h-4 text-red-600" />
              {en ? 'Delete' : 'Hapus'} &quot;{deleting.name}&quot;?
            </h3>
            <ul className="text-xs text-neutral-700 space-y-1.5 list-disc pl-4">
              <li>{en ? 'Users can no longer buy or redeem it.' : 'User tidak bisa membeli atau redeem paket ini lagi.'}</li>
              <li>
                {deleting.activeHolders > 0
                  ? en
                    ? `${deleting.activeHolders} user(s) with an active pass keep it until it runs out or expires.`
                    : `${deleting.activeHolders} user dengan pass aktif tetap bisa memakainya sampai habis atau kedaluwarsa.`
                  : en
                    ? 'No user holds an active pass from it.'
                    : 'Tidak ada user yang memegang pass aktif dari paket ini.'}
              </li>
              <li>{en ? 'Paid transactions stay in history.' : 'Riwayat transaksi yang sudah lunas tetap tersimpan.'}</li>
            </ul>
            {(deleting.pendingPayments > 0 || deleting.activeCodes > 0) && (
              <p className="text-[11px] text-red-800 bg-red-50 border border-red-200 rounded-xl p-3">
                {en ? 'Blocked right now: ' : 'Saat ini diblokir: '}
                {[
                  deleting.pendingPayments > 0 && (en ? `${deleting.pendingPayments} pending payment(s)` : `${deleting.pendingPayments} pembayaran pending`),
                  deleting.activeCodes > 0 && (en ? `${deleting.activeCodes} active redeem code(s) give this package` : `${deleting.activeCodes} kode redeem aktif memberi paket ini`),
                ]
                  .filter(Boolean)
                  .join(', ')}
                . {en ? 'Set it Inactive via Edit to hide it now.' : 'Set Inactive lewat Edit untuk menyembunyikannya sekarang.'}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={close} disabled={isPending} className="px-4 py-2 rounded-xl text-xs font-semibold text-neutral-700 hover:bg-neutral-100 cursor-pointer">
                {en ? 'Cancel' : 'Batal'}
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() => {
                  const fd = new FormData();
                  fd.set('id', deleting.id);
                  run(() => deletePackage(fd), () => setDeleting(null));
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold disabled:opacity-50 cursor-pointer"
              >
                {isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                {en ? 'Delete' : 'Hapus'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
