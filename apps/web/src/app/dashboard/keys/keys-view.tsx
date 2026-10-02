'use client';

import { useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useTranslation } from '@/lib/i18n';
import { revokeApiKey } from '@/lib/actions';
import { timeAgo } from '@/lib/utils';
import {
  ArrowUpRight,
  KeyRound,
  Copy,
  Check,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  Activity,
  Zap,
  Eye,
  EyeOff,
} from 'lucide-react';
import { ApiKeyPingModal } from '@/components/ApiKeyPingModal';

const maskedKey = (prefix: string) => `${(prefix || 'mp-live-').slice(0, 10)}••••••••••••••••`;

interface KeyItem {
  id: string;
  name: string;
  keyPrefix: string;
  rawKey?: string | null;
  status: string;
  expiresAt?: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
}

interface KeysViewProps {
  initialKeys: KeyItem[];
  availableModels?: Array<{ id: string; name: string }>;
}

export function KeysView({ initialKeys, availableModels }: KeysViewProps) {
  const { t, locale } = useTranslation();
  const isId = locale === 'id';
  const [keys, setKeys] = useState<KeyItem[]>(initialKeys);
  const [newKeyName, setNewKeyName] = useState('');
  const [expiresIn, setExpiresIn] = useState<'none' | '30d' | '90d'>('none');
  const [createdRawKey, setCreatedRawKey] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null);
  const [revealedKeys, setRevealedKeys] = useState<Record<string, boolean>>({});
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Test API Key / Quick Ping modal state
  const [isPingModalOpen, setIsPingModalOpen] = useState(false);
  const [testKey, setTestKey] = useState('');

  const getFullKey = (k: KeyItem): string | null => k.rawKey ?? null;

  const toggleReveal = (id: string) => {
    setRevealedKeys((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  const handleCopyKey = (k: KeyItem) => {
    const fullKey = getFullKey(k);
    // Copying the prefix when the secret is unavailable handed out a truncated key that
    // authenticates nowhere, and the copy tick made it look complete. Say so instead.
    if (!fullKey) {
      setCreateError(
        isId
          ? 'Key ini tidak bisa ditampilkan lagi. Cabut lalu buat key baru untuk dapat nilai lengkapnya.'
          : 'This key can no longer be shown. Revoke it and create a new one to get the full value.',
      );
      return;
    }
    navigator.clipboard.writeText(fullKey);
    setCopiedKeyId(k.id);
    setTimeout(() => setCopiedKeyId(null), 2000);
  };

  // Minting goes straight to the gateway through the /api/backend proxy instead of a
  // Server Action: the proxy re-derives the Authorization header from the session, and a
  // route handler keeps working for tabs opened before a deploy (action ids rotate).
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isCreating) return;

    const name = newKeyName.trim();
    if (!name) {
      // The submit button used to be disabled here, so an empty field made the click do
      // nothing with no explanation. Say what is missing instead.
      setCreateError(
        isId ? 'Kasih nama dulu buat key ini.' : 'Give the key a name first.',
      );
      nameInputRef.current?.focus();
      return;
    }

    setCreateError(null);
    setIsCreating(true);
    try {
      const res = await fetch('/api/backend/v1/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, expiresIn }),
      });
      const body = await res.json().catch(() => null);

      if (!res.ok || !body?.key) {
        setCreateError(
          body?.error?.message ||
            (isId ? 'Gagal membuat key. Coba lagi.' : 'Could not create the key. Try again.'),
        );
        return;
      }

      setCreatedRawKey(body.key);
      setTestKey(body.key);
      setKeys((prev) => [
        {
          id: body.id,
          name: body.name,
          keyPrefix: body.prefix,
          rawKey: body.key,
          status: body.status,
          expiresAt: body.expires_at ? new Date(body.expires_at) : null,
          lastUsedAt: null,
          createdAt: body.created_at ? new Date(body.created_at) : new Date(),
        },
        ...prev,
      ]);
      setRevealedKeys((prev) => ({ ...prev, [body.id]: true }));
      setNewKeyName('');
    } catch {
      setCreateError(
        isId
          ? 'Tidak bisa menghubungi server. Cek koneksi lalu coba lagi.'
          : 'Could not reach the server. Check your connection and try again.',
      );
    } finally {
      setIsCreating(false);
    }
  };

  const handleRevoke = (id: string) => {
    startTransition(async () => {
      const fd = new FormData();
      fd.set('id', id);
      await revokeApiKey(fd);
      setKeys((prev) => prev.filter((k) => k.id !== id));
    });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  return (
    <div className="w-full space-y-8">
      {/* Header with Quick Ping Button */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-neutral-200/70 pb-4">
        <div>
          <h1 suppressHydrationWarning className="text-2xl md:text-3xl font-heading font-extrabold text-neutral-950 tracking-tight">
            {t.dashboard.keysPageTitle}
          </h1>
          <p suppressHydrationWarning className="text-xs md:text-sm text-neutral-600 mt-1 max-w-2xl leading-relaxed">
            {t.dashboard.keysPageSubtitle}
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setTestKey(createdRawKey || '');
            setIsPingModalOpen(true);
          }}
          className="group inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-neutral-300 hover:border-neutral-950 bg-white hover:bg-neutral-950 text-neutral-800 hover:text-white text-xs font-semibold transition-all shadow-2xs shrink-0 self-start sm:self-auto cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
        >
          <Activity className="h-3.5 w-3.5 text-neutral-500 group-hover:text-white transition-colors" />
          <span>{isId ? 'Uji Koneksi Key' : 'Test API Key'}</span>
        </button>
      </div>

      {/* Create Key Card */}
      <div className="p-6 rounded-3xl bg-white border border-neutral-200/90 shadow-xs space-y-4">
        <form onSubmit={handleCreate} className="flex flex-col sm:flex-row gap-3">
          <input
            ref={nameInputRef}
            type="text"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder={t.dashboard.keyNameInputPlaceholder}
            aria-label={t.dashboard.keyNameInputPlaceholder}
            aria-invalid={createError ? true : undefined}
            aria-describedby={createError ? 'create-key-error' : undefined}
            className="flex-1 bg-neutral-50 border border-neutral-200 rounded-xl px-4 py-2.5 text-xs text-neutral-900 focus:outline-none focus:border-neutral-950 focus-visible:ring-2 focus-visible:ring-neutral-950 transition-colors"
          />
          <select
            value={expiresIn}
            onChange={(e) => setExpiresIn(e.target.value as any)}
            aria-label={locale === 'en' ? 'API key expiration duration' : 'Masa berlaku kunci API'}
            className="bg-neutral-50 border border-neutral-200 rounded-xl px-3 py-2.5 text-xs text-neutral-800 focus:outline-none focus:border-neutral-950 focus-visible:ring-2 focus-visible:ring-neutral-950 transition-colors shrink-0 cursor-pointer"
          >
            <option value="none">{t.dashboard.expiryNever}</option>
            <option value="30d">{t.dashboard.expiry30Days}</option>
            <option value="90d">{t.dashboard.expiry90Days}</option>
          </select>
          <button
            type="submit"
            disabled={isCreating}
            className="px-5 py-2.5 rounded-xl bg-neutral-950 hover:bg-neutral-800 disabled:opacity-50 text-white text-xs font-bold transition-all shadow-xs shrink-0 flex items-center justify-center gap-1.5 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2 active:scale-95"
          >
            <KeyRound className="h-3.5 w-3.5" />
            <span>{isCreating ? t.dashboard.creatingKeyBtn : t.dashboard.createKeyBtn}</span>
          </button>
        </form>

        {createError && (
          <p id="create-key-error" role="alert" className="flex items-start gap-2 text-xs text-red-700">
            <ShieldAlert className="h-3.5 w-3.5 mt-0.5 shrink-0 text-red-600" />
            <span>{createError}</span>
          </p>
        )}

        {/* Revealed Key Banner with Instant Test Button */}
        {createdRawKey && (
          <div className="p-4 rounded-2xl bg-neutral-900 text-white border border-neutral-800 shadow-md space-y-3 animate-in fade-in slide-in-from-top-3 duration-250 ease-out">
            <div className="flex items-center gap-2 text-xs font-mono text-emerald-400 font-bold">
              <ShieldCheck className="h-4 w-4" />
              <span>{t.dashboard.revealKeyPrompt}</span>
            </div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 p-3 rounded-xl bg-neutral-950 border border-neutral-800">
              <code className="font-mono text-xs text-neutral-200 flex-1 break-all select-all">
                {createdRawKey}
              </code>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setTestKey(createdRawKey);
                    setIsPingModalOpen(true);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-200 hover:text-white border border-neutral-700 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Activity className="h-3.5 w-3.5 text-neutral-500" />
                  <span>{isId ? 'Uji Kunci' : 'Test Key'}</span>
                </button>
                <button
                  onClick={() => copyToClipboard(createdRawKey)}
                  className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  {copiedKey ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-400" />
                      <span className="text-emerald-400">{t.dashboard.copied}</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      <span>{t.dashboard.copy}</span>
                    </>
                  )}
                </button>
              </div>
            </div>
            <div className="flex items-center gap-2 text-[11px] text-neutral-500">
              <ShieldAlert className="h-3.5 w-3.5 text-amber-400 shrink-0" />
              <span>{t.dashboard.revealKeyWarning}</span>
            </div>
          </div>
        )}
      </div>

      {/* Keys Table Card */}
      <div className="rounded-3xl bg-white border border-neutral-200/90 shadow-xs overflow-hidden">
        {keys.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-neutral-100 border border-neutral-200 flex items-center justify-center mx-auto text-neutral-500">
              <KeyRound className="h-6 w-6" />
            </div>
            <div className="text-xs text-neutral-500 max-w-sm mx-auto">
              {t.dashboard.noKeysFound}
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr suppressHydrationWarning className="border-b border-neutral-200 bg-neutral-50/70 text-[11px] font-mono uppercase tracking-wider text-neutral-500">
                  <th className="px-6 py-3.5">{t.dashboard.thName}</th>
                  <th className="px-6 py-3.5">{t.dashboard.thKey}</th>
                  <th className="px-6 py-3.5">{t.dashboard.thStatus}</th>
                  <th className="px-6 py-3.5">{t.dashboard.thExpires}</th>
                  <th className="px-6 py-3.5">{t.dashboard.thLastUsed}</th>
                  <th className="px-6 py-3.5">{t.dashboard.thCreated}</th>
                  <th className="px-6 py-3.5 text-right">{t.dashboard.thAction}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {keys.map((k) => {
                  const fullKey = getFullKey(k);
                  const secretLabel = isId ? 'tidak bisa ditampilkan lagi' : 'no longer retrievable';
                  const unavailableTitle = isId
                    ? 'Nilai lengkap key ini tidak tersimpan. Cabut lalu buat key baru.'
                    : 'The full value of this key is not stored. Revoke it and create a new one.';
                  return (
                  <tr key={k.id} className="hover:bg-neutral-50/50 transition-colors">
                    <td className="px-6 py-4 font-bold text-neutral-900">{k.name}</td>
                    <td className="px-6 py-4 font-mono text-neutral-600">
                      <div className="inline-flex items-center gap-1.5">
                        <span
                          className={`px-2.5 py-1 rounded-lg border text-xs font-mono select-all transition-all ${
                            revealedKeys[k.id] && fullKey
                              ? 'bg-neutral-900 text-emerald-400 border-neutral-800 font-semibold'
                              : 'bg-neutral-100 text-neutral-600 border-neutral-200'
                          }`}
                        >
                          {revealedKeys[k.id] && fullKey ? fullKey : maskedKey(k.keyPrefix)}
                        </span>

                        {!getFullKey(k) && (
                          <span
                            title={
                              isId
                                ? 'Key lama dibuat sebelum enkripsi key aktif (hanya hash satu arah tersimpan). Buat key baru untuk melihat & menyalin key lengkap.'
                                : 'Legacy key created before encrypted storage was enabled. Create a new key to reveal & copy full key.'
                            }
                            className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-700 font-semibold cursor-help shrink-0"
                          >
                            Legacy
                          </span>
                        )}

                        {/* Toggle Visibility (Eye) */}
                        <button
                          type="button"
                          onClick={() => toggleReveal(k.id)}
                          title={
                            !getFullKey(k)
                              ? (isId ? 'Key lama: hanya prefix yang tersedia' : 'Legacy key: only prefix available')
                              : (revealedKeys[k.id] ? t.dashboard.keyHide : t.dashboard.keyShow)
                          }
                          aria-label={revealedKeys[k.id] ? t.dashboard.keyHide : t.dashboard.keyShow}
                          className="p-1.5 rounded-lg border border-neutral-200 hover:border-neutral-400 hover:bg-neutral-100 text-neutral-600 hover:text-neutral-900 transition-colors cursor-pointer shrink-0"
                        >
                          {revealedKeys[k.id] && fullKey ? (
                            <EyeOff className="h-3.5 w-3.5 text-neutral-700" />
                          ) : (
                            <Eye className="h-3.5 w-3.5 text-neutral-600" />
                          )}
                        </button>

                        {/* Copy FULL API Key */}
                        <button
                          type="button"
                          onClick={() => handleCopyKey(k)}
                          title={
                            getFullKey(k)
                              ? t.dashboard.keyCopyFull
                              : isId
                                ? 'Salin prefix (Key lama hanya tersimpan hash. Buat key baru untuk full key)'
                                : 'Copy prefix (Legacy key: only hash stored. Create new key for full key)'
                          }
                          aria-label={t.dashboard.keyCopyFull}
                          className="p-1.5 rounded-lg border border-neutral-200 hover:border-neutral-400 hover:bg-neutral-100 text-neutral-600 hover:text-neutral-900 transition-colors cursor-pointer shrink-0"
                        >
                          {copiedKeyId === k.id ? (
                            <Check className="h-3.5 w-3.5 text-emerald-600" />
                          ) : (
                            <Copy className="h-3.5 w-3.5 text-neutral-600" />
                          )}
                        </button>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {k.status === 'active' && k.expiresAt && new Date(k.expiresAt).getTime() < Date.now() ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-mono font-medium text-red-600">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                          <span suppressHydrationWarning>{t.dashboard.keyStatusExpired}</span>
                        </span>
                      ) : k.status === 'active' ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-mono font-medium text-neutral-700">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                          <span suppressHydrationWarning>{t.dashboard.keyStatusActive}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-xs font-mono font-medium text-neutral-500">
                          <span className="w-1.5 h-1.5 rounded-full bg-neutral-400 shrink-0" />
                          <span>{k.status}</span>
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 font-mono text-[11px]">
                      {k.expiresAt ? (
                        new Date(k.expiresAt).getTime() < Date.now() ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-mono font-medium text-red-600">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                            <span>{t.dashboard.keyStatusExpired}</span>
                          </span>
                        ) : (
                          <span className="text-neutral-700 font-semibold" title={new Date(k.expiresAt).toLocaleString(locale === 'en' ? 'en-US' : 'id-ID')}>
                            {new Date(k.expiresAt).toLocaleDateString(locale === 'en' ? 'en-US' : 'id-ID')}
                          </span>
                        )
                      ) : (
                        <span className="text-neutral-500">{t.dashboard.keyStatusNever}</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-neutral-500 font-mono text-[11px]">
                      {timeAgo(k.lastUsedAt, locale)}
                    </td>
                    <td className="px-6 py-4 text-neutral-500 font-mono text-[11px]">
                      {new Date(k.createdAt).toLocaleDateString(locale === 'en' ? 'en-US' : 'id-ID')}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {confirmRevokeId === k.id ? (
                        <div className="inline-flex items-center gap-1.5 justify-end">
                          <span className="text-[11px] text-red-600 font-bold">
                            {t.dashboard.revokeConfirm}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              handleRevoke(k.id);
                              setConfirmRevokeId(null);
                            }}
                            disabled={isPending}
                            className="px-2 py-0.5 rounded-md bg-red-600 hover:bg-red-700 text-white text-[10px] font-bold transition-all active:scale-95 shadow-2xs cursor-pointer"
                          >
                            {t.dashboard.revokeYes}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmRevokeId(null)}
                            disabled={isPending}
                            className="px-2 py-0.5 rounded-md bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-[10px] font-semibold transition-all active:scale-95 cursor-pointer"
                          >
                            {t.dashboard.revokeCancel}
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmRevokeId(k.id)}
                          className="px-2.5 py-1 rounded-lg border border-neutral-200 hover:border-red-300 hover:bg-red-50 text-neutral-600 hover:text-red-700 text-[11px] font-semibold transition-colors cursor-pointer inline-flex items-center gap-1"
                        >
                          <Trash2 className="h-3 w-3" />
                          <span suppressHydrationWarning>{t.dashboard.revokeBtn}</span>
                        </button>
                      )}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Security Best Practices Callout */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 sm:p-5 rounded-2xl bg-white border border-neutral-200/90 shadow-2xs">
        <div className="flex items-start sm:items-center gap-3.5">
          <div className="w-8 h-8 rounded-xl bg-neutral-100 border border-neutral-200/80 text-neutral-600 flex items-center justify-center shrink-0">
            <ShieldAlert className="h-4 w-4 text-neutral-700" />
          </div>
          <div className="text-xs text-neutral-600 leading-relaxed">
            <span className="font-bold text-neutral-950 block sm:inline mr-1.5">
              {t.dashboard.keySecurityLabel}
            </span>
            <span>
              {t.dashboard.keySecurityDesc}
            </span>
          </div>
        </div>

        <Link
          href="/docs"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-neutral-200 hover:border-neutral-300 hover:bg-neutral-50 text-xs font-semibold text-neutral-800 hover:text-neutral-950 transition-all shrink-0 self-start sm:self-auto cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
        >
          <span>{t.dashboard.setupGuidesLink}</span>
          <ArrowUpRight className="h-3.5 w-3.5 text-neutral-500" />
        </Link>
      </div>

      {/* Test API Key Modal */}
      <ApiKeyPingModal
        isOpen={isPingModalOpen}
        onClose={() => setIsPingModalOpen(false)}
        initialApiKey={testKey}
        availableModels={availableModels}
      />
    </div>
  );
}
