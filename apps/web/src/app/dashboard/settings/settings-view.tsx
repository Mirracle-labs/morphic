'use client';

import { useState, useEffect, useTransition } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@/lib/i18n';
import { SignOutButton } from '@/app/dashboard/sign-out';
import { revokeOtherSessions, revokeSessionById, type ActiveSession } from '@/lib/actions';
import { timeAgo } from '@/lib/utils';
import {
  User,
  Mail,
  KeyRound,
  ShieldCheck,
  Check,
  Copy,
  AlertTriangle,
  ArrowUpRight,
  Clock,
  Laptop,
  Lock,
  CheckCircle2,
  ExternalLink,
  Shield,
  LifeBuoy,
} from 'lucide-react';

interface SettingsViewProps {
  user: {
    id: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
    createdAt?: Date | string | null;
    emailVerified?: boolean | null;
    role?: string | null;
  };
  sessions: ActiveSession[];
}

/** Reads the browser and platform out of a user agent string for the session list. */
function describeDevice(userAgent: string | null, isId: boolean): string {
  if (!userAgent) return isId ? 'Perangkat tidak dikenal' : 'Unknown device';

  const browser =
    /Edg\//.test(userAgent) ? 'Edge'
    : /OPR\/|Opera/.test(userAgent) ? 'Opera'
    : /Firefox\//.test(userAgent) ? 'Firefox'
    : /Chrome\//.test(userAgent) ? 'Chrome'
    : /Safari\//.test(userAgent) ? 'Safari'
    : null;

  const platform =
    /Android/.test(userAgent) ? 'Android'
    : /iPhone|iPad|iPod/.test(userAgent) ? 'iOS'
    : /Windows/.test(userAgent) ? 'Windows'
    : /Mac OS X/.test(userAgent) ? 'macOS'
    : /Linux/.test(userAgent) ? 'Linux'
    : null;

  if (browser && platform) return `${browser} · ${platform}`;
  return browser ?? platform ?? (isId ? 'Perangkat tidak dikenal' : 'Unknown device');
}

export function SettingsView({ user, sessions }: SettingsViewProps) {
  const { locale } = useTranslation();
  const isId = locale === 'id';
  const router = useRouter();

  const [copiedId, setCopiedId] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [copiedSupport, setCopiedSupport] = useState(false);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const otherSessions = sessions.filter((item) => !item.isCurrent);

  const genericSessionError = isId
    ? 'Gagal memproses sesi. Muat ulang halaman lalu coba lagi.'
    : 'Could not update the session. Reload the page and try again.';

  const handleRevoke = (id: string) => {
    setSessionError(null);
    setRevokingId(id);
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set('id', id);
        const res = await revokeSessionById(fd);
        if (!res.ok) {
          setSessionError(res.error ?? genericSessionError);
          return;
        }
        router.refresh();
      } catch {
        setSessionError(genericSessionError);
      } finally {
        setRevokingId(null);
      }
    });
  };

  const handleRevokeOthers = () => {
    setSessionError(null);
    setRevokingId('others');
    startTransition(async () => {
      try {
        const res = await revokeOtherSessions();
        if (!res.ok) {
          setSessionError(res.error ?? genericSessionError);
          return;
        }
        router.refresh();
      } catch {
        setSessionError(genericSessionError);
      } finally {
        setRevokingId(null);
      }
    });
  };

  const copyUserId = () => {
    navigator.clipboard.writeText(user.id);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  const copySupportEmail = () => {
    navigator.clipboard.writeText('support@morphic.sh');
    setCopiedSupport(true);
    setTimeout(() => setCopiedSupport(false), 2000);
  };

  useEffect(() => {
    if (!showDeleteModal) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowDeleteModal(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showDeleteModal]);

  const memberSince = user.createdAt
    ? new Date(user.createdAt).toLocaleDateString(isId ? 'id-ID' : 'en-US', {
        month: 'long',
        year: 'numeric',
      })
    : null;

  return (
    <div className="w-full max-w-4xl space-y-8 pb-12">
      {/* Page Header */}
      <div className="border-b border-neutral-200/80 pb-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-heading font-extrabold text-neutral-950 tracking-tight">
              {isId ? 'Pengaturan Akun' : 'Account Settings'}
            </h1>
            <p className="text-xs md:text-sm text-neutral-600 mt-1 max-w-2xl leading-relaxed">
              {isId
                ? 'Kelola identitas akun pengembang, status otentikasi sesi, dan standar keamanan data gateway Anda.'
                : 'Manage your account, active sessions, and gateway data security standards.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono font-medium text-neutral-800 border border-neutral-200 bg-neutral-50/80">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
              <span>{isId ? 'Akun Aktif' : 'Account Active'}</span>
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        {/* CARD 1: Account Profile & Identity */}
        <section
          aria-labelledby="profile-heading"
          className="rounded-3xl bg-white border border-neutral-200/90 shadow-2xs overflow-hidden"
        >
          <div className="p-5 sm:p-7 border-b border-neutral-100 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-neutral-100 flex items-center justify-center text-neutral-700">
                <User className="h-4 w-4" />
              </div>
              <div>
                <h2 id="profile-heading" className="text-sm sm:text-base font-bold text-neutral-950 font-heading">
                  {isId ? 'Profil & Identitas Akun' : 'Account Profile & Identity'}
                </h2>
                <p className="text-xs text-neutral-500">
                  {isId ? 'Informasi dasar akun Anda di Morphic' : 'Your core account information on Morphic'}
                </p>
              </div>
            </div>
            <span className="text-[11px] font-mono px-2.5 py-1 rounded-lg bg-neutral-100 text-neutral-700 font-semibold border border-neutral-200/80 uppercase">
              {user.role ?? (isId ? 'pengguna' : 'user')}
            </span>
          </div>

          <div className="p-5 sm:p-7 space-y-6">
            {/* Avatar & Summary */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6 pb-6 border-b border-neutral-100">
              {user.image ? (
                <Image
                  src={user.image}
                  alt={user.name || 'Avatar'}
                  width={72}
                  height={72}
                  referrerPolicy="no-referrer"
                  className="w-16 h-16 sm:w-18 sm:h-18 rounded-2xl object-cover ring-1 ring-neutral-200 shadow-2xs shrink-0"
                />
              ) : (
                <div className="w-16 h-16 sm:w-18 sm:h-18 rounded-2xl bg-neutral-100 border border-neutral-200/80 flex items-center justify-center text-xl font-bold text-neutral-800 shadow-2xs shrink-0">
                  {(user.name?.charAt(0) || user.email?.charAt(0) || 'D').toUpperCase()}
                </div>
              )}

              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-base sm:text-lg font-bold text-neutral-950 truncate">
                    {user.name || user.email || (isId ? 'Tanpa nama' : 'Unnamed account')}
                  </h3>
                  {user.emailVerified ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-neutral-600">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                      <span>{isId ? 'Email terverifikasi' : 'Email verified'}</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-neutral-500">
                      <span className="w-1.5 h-1.5 rounded-full bg-neutral-400 shrink-0" />
                      <span>{isId ? 'Email belum terverifikasi' : 'Email not verified'}</span>
                    </span>
                  )}
                </div>
                <p className="text-xs sm:text-sm text-neutral-600 truncate">{user.email}</p>
                {memberSince && (
                  <p className="text-xs text-neutral-500 flex items-center gap-1.5 pt-0.5">
                    <Clock className="h-3.5 w-3.5 text-neutral-500" />
                    <span>{isId ? `Bergabung sejak ${memberSince}` : `Member since ${memberSince}`}</span>
                  </p>
                )}
              </div>
            </div>

            {/* Profile Fields Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Display Name */}
              <div className="p-4 rounded-2xl bg-neutral-50/60 border border-neutral-200/70 space-y-1">
                <div className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">
                  {isId ? 'Nama Lengkap' : 'Display Name'}
                </div>
                <div className="text-sm font-semibold text-neutral-900 truncate">
                  {user.name || (isId ? 'Belum diatur' : 'Not specified')}
                </div>
                <p className="text-[11px] text-neutral-500">
                  {isId ? 'Diambil otomatis dari penyedia login.' : 'Synchronized via your login provider.'}
                </p>
              </div>

              {/* Primary Email */}
              <div className="p-4 rounded-2xl bg-neutral-50/60 border border-neutral-200/70 space-y-1">
                <div className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">
                  {isId ? 'Email Utama' : 'Primary Email'}
                </div>
                <div className="text-sm font-semibold text-neutral-900 truncate">
                  {user.email}
                </div>
                <p className="text-[11px] text-neutral-500">
                  {isId ? 'Alamat kontak untuk notifikasi transaksi & kuota.' : 'Contact email for alerts and transaction receipts.'}
                </p>
              </div>

              {/* Account UUID */}
              <div className="md:col-span-2 p-4 rounded-2xl bg-neutral-50/60 border border-neutral-200/70 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">
                    {isId ? 'ID Akun (UUID)' : 'Account ID (UUID)'}
                  </div>
                  <button
                    type="button"
                    onClick={copyUserId}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-neutral-200 hover:bg-neutral-100 active:scale-95 text-neutral-700 hover:text-neutral-950 transition text-xs font-semibold shadow-2xs cursor-pointer"
                  >
                    {copiedId ? (
                      <>
                        <Check className="h-3 w-3 text-emerald-600" />
                        <span className="text-emerald-700">{isId ? 'Tersalin' : 'Copied'}</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3 text-neutral-500" />
                        <span>{isId ? 'Salin ID' : 'Copy ID'}</span>
                      </>
                    )}
                  </button>
                </div>
                <div className="font-mono text-xs text-neutral-900 bg-white px-3 py-2 rounded-xl border border-neutral-200/80 select-all truncate">
                  {user.id}
                </div>
                <p className="text-[11px] text-neutral-500">
                  {isId
                    ? 'Pengenal unik akun Anda untuk referensi dukungan tiket dan sistem gateway.'
                    : 'Unique identifier used for support inquiries and system-level gateway routing.'}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* CARD 2: Security & Active Sessions */}
        <section
          aria-labelledby="security-heading"
          className="rounded-3xl bg-white border border-neutral-200/90 shadow-2xs overflow-hidden"
        >
          <div className="p-5 sm:p-7 border-b border-neutral-100 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-neutral-100 flex items-center justify-center text-neutral-700">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <div>
                <h2 id="security-heading" className="text-sm sm:text-base font-bold text-neutral-950 font-heading">
                  {isId ? 'Autentikasi & Keamanan Sesi' : 'Authentication & Active Session'}
                </h2>
                <p className="text-xs text-neutral-500">
                  {isId ? 'Status keamanan sesi browser dan perlindungan kredensial Anda' : 'Current browser session status and credential protection'}
                </p>
              </div>
            </div>
          </div>

          <div className="p-5 sm:p-7 space-y-4">
            {sessions.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between p-4 rounded-2xl bg-neutral-50/60 border border-neutral-200/70 gap-4"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-white border border-neutral-200 flex items-center justify-center text-neutral-700 shadow-2xs shrink-0">
                    <Laptop className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs sm:text-sm font-semibold text-neutral-950">
                        {describeDevice(item.userAgent, isId)}
                      </span>
                      {item.isCurrent && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-mono text-neutral-600">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                          <span>{isId ? 'perangkat ini' : 'this device'}</span>
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-neutral-500 truncate mt-0.5">
                      {item.ipAddress ? `${item.ipAddress} · ` : ''}
                      {isId ? 'masuk ' : 'signed in '}
                      {timeAgo(item.createdAt, locale)}
                      {' · '}
                      {isId ? 'berlaku sampai ' : 'valid until '}
                      {new Date(item.expiresAt).toLocaleDateString(isId ? 'id-ID' : 'en-US', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </p>
                  </div>
                </div>

                {item.isCurrent ? (
                  <SignOutButton className="px-3 py-1.5 rounded-xl bg-white border border-neutral-200 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 text-neutral-700 text-xs font-semibold transition-colors shadow-2xs cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950">
                    {isId ? 'Keluar Sesi' : 'Sign Out'}
                  </SignOutButton>
                ) : (
                  <button
                    type="button"
                    onClick={() => handleRevoke(item.id)}
                    disabled={revokingId !== null}
                    className="px-3 py-1.5 rounded-xl bg-white border border-neutral-200 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 disabled:opacity-60 text-neutral-700 text-xs font-semibold transition-colors shadow-2xs cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
                  >
                    {revokingId === item.id
                      ? isId
                        ? 'Mengeluarkan...'
                        : 'Signing out...'
                      : isId
                        ? 'Keluarkan'
                        : 'Sign out'}
                  </button>
                )}
              </div>
            ))}

            {otherSessions.length > 0 && (
              <button
                type="button"
                onClick={handleRevokeOthers}
                disabled={revokingId !== null}
                className="w-full px-3 py-2 rounded-2xl border border-neutral-200 bg-white hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 disabled:opacity-60 text-neutral-700 text-xs font-semibold transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
              >
                {revokingId === 'others'
                  ? isId
                    ? 'Mengeluarkan perangkat lain...'
                    : 'Signing out other devices...'
                  : isId
                    ? `Keluarkan ${otherSessions.length} perangkat lain`
                    : `Sign out ${otherSessions.length} other device${otherSessions.length > 1 ? 's' : ''}`}
              </button>
            )}

            {sessionError && (
              <p role="alert" className="flex items-start gap-2 text-xs text-red-700">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0 text-red-600" />
                <span>{sessionError}</span>
              </p>
            )}

            {/* Security Guarantee Rows */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div className="p-4 rounded-2xl border border-neutral-200/70 bg-white space-y-1.5">
                <div className="flex items-center gap-2">
                  <Lock className="h-4 w-4 text-neutral-600" />
                  <span className="text-xs font-bold text-neutral-900">
                    {isId ? 'Penyimpanan Kunci Terenkripsi' : 'Encrypted Key Storage'}
                  </span>
                </div>
                <p className="text-xs text-neutral-600 leading-relaxed">
                  {isId
                    ? 'Seluruh API Key yang Anda buat hanya disimpan dalam bentuk hash kriptografi SHA-256 satu arah.'
                    : 'All API keys generated are strictly stored as one-way SHA-256 cryptographic hashes.'}
                </p>
              </div>

              <div className="p-4 rounded-2xl border border-neutral-200/70 bg-white space-y-1.5">
                <div className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-neutral-600" />
                  <span className="text-xs font-bold text-neutral-900">
                    {isId ? 'Rotasi Mandiri Instan' : 'Instant Key Revocation'}
                  </span>
                </div>
                <p className="text-xs text-neutral-600 leading-relaxed">
                  {isId
                    ? 'Kunci dapat dicabut kapan saja di tab API Keys dengan masa propagasi seketika (< 1 detik).'
                    : 'Keys can be revoked anytime in the API Keys tab with sub-second gateway propagation.'}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* CARD 3: Gateway Privacy & Data Governance (ZDR) */}
        <section
          aria-labelledby="privacy-heading"
          className="rounded-3xl bg-white border border-neutral-200/90 shadow-2xs overflow-hidden"
        >
          <div className="p-5 sm:p-7 border-b border-neutral-100 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-neutral-100 flex items-center justify-center text-neutral-700">
                <Shield className="h-4 w-4" />
              </div>
              <div>
                <h2 id="privacy-heading" className="text-sm sm:text-base font-bold text-neutral-950 font-heading">
                  {isId ? 'Privasi & Tata Kelola Data Gateway' : 'Privacy & Gateway Data Governance'}
                </h2>
                <p className="text-xs text-neutral-500">
                  {isId ? 'Standar perlindungan kode sumber dan payload request Anda' : 'Source code protection and request payload policies'}
                </p>
              </div>
            </div>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono font-medium text-neutral-800 border border-neutral-200 bg-neutral-50/80">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
              <span>{isId ? 'ZDR Aktif' : 'ZDR Enforced'}</span>
            </span>
          </div>

          <div className="p-5 sm:p-7 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-4 rounded-2xl bg-neutral-50/60 border border-neutral-200/70 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-neutral-950">
                    {isId ? 'Zero Data Retention (ZDR)' : 'Zero Data Retention (ZDR)'}
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-neutral-100 text-neutral-700 font-semibold border border-neutral-200/60">
                    100% PASS-THROUGH
                  </span>
                </div>
                <p className="text-xs text-neutral-600 leading-relaxed">
                  {isId
                    ? 'Morphic beroperasi murni sebagai reverse proxy cerdas. Seluruh payload prompt dan completion dialirkan langsung tanpa pernah disimpan ke storage permanen.'
                    : 'Morphic operates as a transparent reverse proxy. All prompt payloads and completions stream directly without permanent disk persistence.'}
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-neutral-50/60 border border-neutral-200/70 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-neutral-950">
                    {isId ? 'Bebas Training AI' : 'No Model Retraining'}
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-neutral-200/80 text-neutral-800 font-semibold">
                    EXCLUDED
                  </span>
                </div>
                <p className="text-xs text-neutral-600 leading-relaxed">
                  {isId
                    ? 'Perjanjian enterprise upstream menjamin kode Anda tidak akan pernah digunakan untuk melatih ulang bobot model AI provider manapun.'
                    : 'Upstream enterprise agreements guarantee your code is never used to train or fine-tune public foundation models.'}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* CARD 4: Danger Zone */}
        <section
          aria-labelledby="danger-heading"
          className="rounded-3xl border border-red-200/90 bg-red-50/20 shadow-2xs overflow-hidden"
        >
          <div className="p-5 sm:p-7 border-b border-red-200/60 bg-red-50/40 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-red-100 flex items-center justify-center text-red-700">
                <AlertTriangle className="h-4 w-4" />
              </div>
              <div>
                <h2 id="danger-heading" className="text-sm sm:text-base font-bold text-red-950 font-heading">
                  {isId ? 'Zona Berbahaya' : 'Danger Zone'}
                </h2>
                <p className="text-xs text-red-700/80">
                  {isId ? 'Tindakan berikut bersifat permanen dan berdampak langsung pada akses gateway Anda.' : 'These actions are permanent and directly affect your active gateway access.'}
                </p>
              </div>
            </div>
          </div>

          <div className="p-5 sm:p-7 divide-y divide-red-100/80">
            {/* Revoke all keys row */}
            <div className="py-4 first:pt-0 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1 max-w-lg">
                <h3 className="text-xs sm:text-sm font-bold text-neutral-950">
                  {isId ? 'Cabut atau Kelola API Keys' : 'Revoke or Manage API Keys'}
                </h3>
                <p className="text-xs text-neutral-600 leading-relaxed">
                  {isId
                    ? 'Jika Anda mencurigai adanya kebocoran kunci di repository publik atau log terminal, segera cabut kunci yang terdampak.'
                    : 'If you suspect an API key leak in a public repository or terminal log, revoke the affected keys immediately.'}
                </p>
              </div>
              <Link
                href="/dashboard/keys"
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-white border border-neutral-300 hover:border-neutral-400 text-neutral-800 text-xs font-bold transition shadow-2xs hover:bg-neutral-50 shrink-0 cursor-pointer"
              >
                <span>{isId ? 'Buka Panel Kunci' : 'Manage Keys'}</span>
                <ArrowUpRight className="h-3.5 w-3.5 text-neutral-500" />
              </Link>
            </div>

            {/* Delete Account row */}
            <div className="py-4 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1 max-w-lg">
                <h3 className="text-xs sm:text-sm font-bold text-red-950">
                  {isId ? 'Hapus Akun' : 'Delete Account'}
                </h3>
                <p className="text-xs text-neutral-600 leading-relaxed">
                  {isId
                    ? 'Menghapus identitas akun, memutus seluruh API Key secara permanen, dan menghanguskan sisa kredit token Anda.'
                    : 'Permanently remove your account, invalidate all active API keys, and forfeit any remaining token credit balance.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowDeleteModal(true)}
                className="inline-flex items-center justify-center px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition shadow-2xs cursor-pointer shrink-0"
              >
                {isId ? 'Hapus Akun' : 'Delete Account'}
              </button>
            </div>
          </div>
        </section>
      </div>

      {/* Confirmation Modal for Delete Account */}
      {showDeleteModal && (
        <div
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowDeleteModal(false);
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-account-title"
            className="w-full max-w-md rounded-3xl bg-white p-6 shadow-xl border border-neutral-200 space-y-4 animate-in fade-in zoom-in-95 duration-150"
          >
            <div className="flex items-center gap-3 text-red-600">
              <div className="w-10 h-10 rounded-2xl bg-red-50 border border-red-200 flex items-center justify-center shrink-0">
                <AlertTriangle className="h-5 w-5 text-red-600" />
              </div>
              <div>
                <h4 id="delete-account-title" className="text-base font-bold text-neutral-950 font-heading">
                  {isId ? 'Konfirmasi Hapus Akun' : 'Confirm Account Deletion'}
                </h4>
                <p className="text-xs text-neutral-500">{user.email}</p>
              </div>
            </div>

            <p className="text-xs text-neutral-600 leading-relaxed">
              {isId
                ? 'Untuk melindungi saldo kredit dan mencegah pembatalan tak disengaja pada integrasi sistem produksi, penghapusan akun diverifikasi secara manual oleh tim engineering kami.'
                : 'To protect remaining credit balances and prevent accidental downtime for production workflows, account deletions are processed with engineering verification.'}
            </p>

            <div className="p-3 rounded-xl bg-neutral-50 border border-neutral-200/80 flex items-center justify-between text-xs">
              <span className="font-mono text-neutral-700 select-all">support@morphic.sh</span>
              <button
                type="button"
                onClick={copySupportEmail}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-neutral-700 hover:text-black cursor-pointer"
              >
                {copiedSupport ? (
                  <>
                    <Check className="h-3 w-3 text-emerald-600" />
                    <span className="text-emerald-700">{isId ? 'Tersalin' : 'Copied'}</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" />
                    <span>{isId ? 'Salin' : 'Copy'}</span>
                  </>
                )}
              </button>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowDeleteModal(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-neutral-700 hover:bg-neutral-100 transition cursor-pointer"
              >
                {isId ? 'Tutup' : 'Close'}
              </button>
              <a
                href={`mailto:support@morphic.sh?subject=Permintaan%20Penghapusan%20Akun%20(${encodeURIComponent(user.id)})`}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold transition shadow-2xs cursor-pointer"
              >
                <LifeBuoy className="h-3.5 w-3.5" />
                <span>{isId ? 'Hubungi Tim Support' : 'Contact Support'}</span>
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
