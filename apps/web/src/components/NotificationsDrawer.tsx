// apps/web/src/components/NotificationsDrawer.tsx
// TypeScript React / Next.js Client Component / Browser + SSR / Linux x86_64
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Bell, CheckCheck, X } from 'lucide-react';
import { formatCredits } from '@/lib/utils';
import type { NotificationItem } from '@/lib/notifications';
import { makerByPrefix, makerFromId } from '@/lib/model-maker';
import { getNotificationsAction } from '@/lib/actions';
import { useLocalStorage } from '@/lib/use-local-storage';

type Tab = 'all' | 'unread' | 'model' | 'changelog' | 'account';

// ponytail: read state is per-browser (localStorage). Move to a users column if it must sync across devices.
const SEEN_KEY = 'morphic:notifications-seen';

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950';

const money = (cents: number, currency: string) =>
  currency === 'USD' ? `$${(cents / 100).toFixed(2)}` : `Rp ${cents.toLocaleString('id-ID')}`;

const dateKeyFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' });
const shortDateEn = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'Asia/Jakarta' });
const shortDateId = new Intl.DateTimeFormat('id-ID', { month: 'short', day: 'numeric', timeZone: 'Asia/Jakarta' });

// Model announcement banners. Per maker: the company mark (top), the model family mark (centre) and a
// three-stop gradient from the brand's own palette (deep, main, light). Marks are LobeHub mono SVGs
// painted white through a CSS mask, so every logo reads as a clean transparent silhouette.
type Banner = { top: string | null; mark: string | null; colors: [string, string, string] };
const BANNERS: Record<string, Banner> = {
  OpenAI: { top: 'openai', mark: 'openai', colors: ['#06281f', '#0d8a6a', '#7ee8c6'] },
  Anthropic: { top: 'anthropic', mark: 'claude', colors: ['#5a1d0c', '#c9603d', '#f6b48a'] },
  Google: { top: 'google', mark: 'gemini', colors: ['#0b1f5c', '#2f6fe4', '#8ec5ff'] },
  DeepSeek: { top: 'deepseek', mark: 'deepseek', colors: ['#120f5c', '#3d5afe', '#8fb4ff'] },
  Qwen: { top: 'qwen', mark: 'qwen', colors: ['#2a0a5e', '#5b4ee8', '#c2b5ff'] },
  Alibaba: { top: 'alibaba', mark: 'alibaba', colors: ['#5c1a05', '#f05a00', '#ffb36b'] },
  MoonshotAI: { top: 'moonshot', mark: 'kimi', colors: ['#050b24', '#1648e8', '#6fd0ff'] },
  xAI: { top: 'xai', mark: 'grok', colors: ['#050505', '#2e2e33', '#8b8b94'] },
  'Z.ai': { top: 'zai', mark: 'zai', colors: ['#081a4d', '#2160f0', '#5fe3f5'] },
  MiniMax: { top: 'minimax', mark: 'minimax', colors: ['#7a0a1c', '#e0213f', '#ff9a3c'] },
  Mistral: { top: 'mistral', mark: 'mistral', colors: ['#5c1505', '#f04d0c', '#ffd23f'] },
  Meta: { top: 'meta', mark: 'meta', colors: ['#120f3d', '#5a33e0', '#8fb8ff'] },
  ByteDance: { top: 'bytedance', mark: 'doubao', colors: ['#071f4d', '#2f7af0', '#5ee6d3'] },
  Tencent: { top: 'tencent', mark: 'hunyuan', colors: ['#06245c', '#0a56d6', '#4cc3ff'] },
  Xiaomi: { top: 'xiaomimimo', mark: 'xiaomimimo', colors: ['#5c1a05', '#f26100', '#ffbf7a'] },
  StepFun: { top: 'stepfun', mark: 'stepfun', colors: ['#0b1433', '#1f5ae0', '#3fd6f0'] },
  inclusionAI: { top: 'ling', mark: 'ling', colors: ['#0a2a7a', '#1f6ff0', '#7cc0ff'] },
  Meituan: { top: 'longcat', mark: 'longcat', colors: ['#5c3305', '#e8930a', '#ffe08a'] },
  Baidu: { top: 'baidu', mark: 'wenxin', colors: ['#0f1a52', '#2a35d9', '#8a93ff'] },
  'Black Forest Labs': { top: 'bfl', mark: 'flux', colors: ['#06163d', '#1747c9', '#2fd3f0'] },
  KlingAI: { top: 'kling', mark: 'kling', colors: ['#06301a', '#139a48', '#a6e84a'] },
  PixVerse: { top: 'pixverse', mark: 'pixverse', colors: ['#3b0a52', '#a3239f', '#ff7ac0'] },
  'Sakana AI': { top: 'sakana', mark: 'sakana', colors: ['#3d0808', '#d12a2a', '#ffa3a3'] },
};
const FALLBACK: Banner = { top: null, mark: null, colors: ['#111114', '#3a3a42', '#8b8b94'] };

// Fine film grain, as in the reference banners: inline SVG turbulence, no image request.
const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

function MonoMark({ name, className }: { name: string; className: string }) {
  const url = `url(/logos/mono/${name}.svg)`;
  return (
    <span
      className={`inline-block shrink-0 bg-white ${className}`}
      style={{ maskImage: url, WebkitMaskImage: url, maskSize: 'contain', WebkitMaskSize: 'contain', maskRepeat: 'no-repeat', WebkitMaskRepeat: 'no-repeat', maskPosition: 'center', WebkitMaskPosition: 'center' }}
    />
  );
}

/** "Morphic | Maker" announcement card for a newly live model. Pure CSS, no generated image. */
function ModelBanner({ modelId, name }: { modelId: string; name: string }) {
  // Catalog slugs carry the maker as a prefix; older ids ("deepseek-v4") fall back to keyword matching.
  const keyword = makerFromId(modelId);
  const makerName = makerByPrefix(modelId)?.maker ?? (keyword === 'Other' ? null : { Moonshot: 'MoonshotAI', Zhipu: 'Z.ai' }[keyword] ?? keyword);
  const mk = makerName ? { maker: makerName } : null;
  const b = (mk && BANNERS[mk.maker]) || FALLBACK;
  const [deep, main, light] = b.colors;
  return (
    <div
      aria-hidden="true"
      className="relative mt-3 aspect-[9/4] w-full overflow-hidden rounded-2xl text-white"
      style={{
        background: `radial-gradient(55% 75% at 12% 15%, ${light} 0%, transparent 65%), radial-gradient(60% 80% at 90% 95%, ${light} 0%, transparent 60%), radial-gradient(70% 90% at 55% 35%, ${deep} 0%, transparent 70%), linear-gradient(135deg, ${main} 0%, ${deep} 55%, ${main} 100%)`,
      }}
    >
      <div className="pointer-events-none absolute inset-0 opacity-30 mix-blend-overlay" style={{ backgroundImage: GRAIN }} />
      <div className="absolute inset-x-0 top-[12%] flex items-center justify-center gap-3 sm:gap-4">
        <Image src="/morphic-brand-clean.png" alt="" width={110} height={26} className="h-4 sm:h-5 w-auto brightness-0 invert" />
        {mk && (
          <>
            <span className="h-4 sm:h-5 w-px bg-white/50" />
            <span className="flex items-center gap-1.5 text-sm sm:text-base font-bold tracking-tight">
              {b.top && <MonoMark name={b.top} className="h-4 w-4 sm:h-5 sm:w-5" />}
              {mk.maker}
            </span>
          </>
        )}
      </div>
      <div className="absolute inset-0 flex items-center justify-center gap-3 sm:gap-5 px-6 pt-6 sm:pt-8 [text-shadow:0_1px_12px_rgba(0,0,0,.25)]">
        {b.mark && <MonoMark name={b.mark} className="h-10 w-10 sm:h-14 sm:w-14" />}
        <span className="line-clamp-2 text-2xl sm:text-4xl font-medium tracking-tight leading-tight">{name}</span>
      </div>
    </div>
  );
}

function content(n: NotificationItem, en: boolean): { title: string; body: string; link?: { href: string; label: string } } {
  switch (n.type) {
    case 'model_new':
      return {
        title: `${en ? 'New model available' : 'Model baru tersedia'}: ${n.name}`,
        body: n.description ?? (en ? `${n.modelId} is now live on the gateway.` : `${n.modelId} sudah aktif di gateway.`),
        link: { href: `/models/${n.modelId}`, label: en ? 'View model detail' : 'Lihat detail model' },
      };
    case 'model_retired':
      return {
        title: en ? 'Model retirement notice' : 'Pemberitahuan model dihentikan',
        body:
          (en ? `${n.name} (${n.modelId}) is deprecated.` : `${n.name} (${n.modelId}) sudah deprecated.`) +
          (n.replacement ? (en ? ` Switch to ${n.replacement}.` : ` Ganti ke ${n.replacement}.`) : ''),
      };
    case 'payment':
      return n.gift
        ? {
            title: en ? 'Gift card paid' : 'Gift card terbayar',
            body: en ? `${money(n.amountCents, n.currency)} paid. The code is ready in Rewards.` : `${money(n.amountCents, n.currency)} terbayar. Kodenya sudah ada di Hadiah.`,
            link: { href: '/dashboard/redeem', label: en ? 'Open Rewards' : 'Buka Hadiah' },
          }
        : {
            title: en ? 'Top-up successful' : 'Top-up berhasil',
            body: en
              ? `${formatCredits(n.credits)} credits added (${money(n.amountCents, n.currency)}).`
              : `${formatCredits(n.credits)} kredit masuk (${money(n.amountCents, n.currency)}).`,
            link: { href: '/dashboard/billing', label: en ? 'View billing' : 'Lihat billing' },
          };
    case 'gift_redeemed':
      return {
        title: en ? 'Your gift card was redeemed' : 'Gift card kamu sudah ditukar',
        body: en ? `${formatCredits(n.credits)} credits reached your recipient.` : `${formatCredits(n.credits)} kredit sudah sampai ke penerima.`,
      };
    case 'announcement':
      return {
        title: n.title,
        body: n.body,
        link: n.linkUrl ? { href: n.linkUrl, label: en ? 'Read more' : 'Selengkapnya' } : undefined,
      };
  }
}

export function NotificationsDrawer({ items: initial, en }: { items: NotificationItem[] | null; en: boolean }) {
  const [items, setItems] = useState(initial);
  const [isOpen, setIsOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState<Tab>('all');
  const [seen, setSeen] = useLocalStorage(SEEN_KEY);

  // The layout's copy goes stale on client navigation; re-read on open and every 2 min while visible.
  const refresh = () => {
    getNotificationsAction()
      .then(setItems)
      .catch(() => {}); // keep showing the last good list
  };
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, 120_000);
    return () => clearInterval(id);
  }, []);

  const list = useMemo(() => items ?? [], [items]);
  const isUnread = (n: NotificationItem) => !seen || n.at > seen;
  const unread = useMemo(() => list.filter((n) => !seen || n.at > seen), [list, seen]);

  const markAllRead = () => setSeen(new Date().toISOString());

  const tabs: [Tab, string, number][] = [
    ['all', en ? 'All' : 'Semua', list.length],
    ['unread', en ? 'Unread' : 'Belum dibaca', unread.length],
    ['model', en ? 'Models' : 'Model', list.filter((n) => n.kind === 'model').length],
    ['changelog', 'Changelog', list.filter((n) => n.kind === 'changelog').length],
    ['account', en ? 'Account' : 'Akun', list.filter((n) => n.kind === 'account').length],
  ];
  const shown = tab === 'all' ? list : tab === 'unread' ? unread : list.filter((n) => n.kind === tab);

  const todayKey = dateKeyFmt.format(new Date());
  const yesterdayKey = dateKeyFmt.format(new Date(Date.now() - 86_400_000));
  const dayLabel = (iso: string) => {
    const d = new Date(iso);
    const k = dateKeyFmt.format(d);
    if (k === todayKey) return en ? 'Today' : 'Hari ini';
    if (k === yesterdayKey) return en ? 'Yesterday' : 'Kemarin';
    return (en ? shortDateEn : shortDateId).format(d);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setIsOpen(true);
          dialogRef.current?.showModal();
          refresh();
        }}
        aria-label={en ? `Notifications, ${unread.length} unread` : `Notifikasi, ${unread.length} belum dibaca`}
        className={`relative w-9 h-9 flex items-center justify-center rounded-full text-neutral-800 hover:bg-white transition-colors cursor-pointer ${focusRing}`}
      >
        <Bell className="h-5 w-5" />
        {unread.length > 0 && (
          <span aria-hidden="true" className="absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full bg-red-600 text-[10px] font-semibold leading-4 text-white text-center tabular-nums">
            {unread.length > 99 ? '99+' : unread.length}
          </span>
        )}
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby="notif-title"
        onClose={() => setIsOpen(false)}
        onClick={(e) => e.target === dialogRef.current && dialogRef.current?.close()}
        className="m-0 ml-auto h-dvh max-h-dvh w-full max-w-xl bg-white p-0 shadow-2xl backdrop:bg-neutral-950/40 sm:my-2 sm:mr-2 sm:h-[calc(100dvh-1rem)] sm:max-h-[calc(100dvh-1rem)] sm:rounded-3xl sm:border sm:border-neutral-200/70"
      >
        {isOpen && (
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between gap-3 border-b border-neutral-200 px-5 py-4">
              <h2 id="notif-title" className="text-lg font-semibold text-neutral-950">{en ? 'Notifications' : 'Notifikasi'}</h2>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={markAllRead}
                  disabled={unread.length === 0}
                  className={`inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm text-neutral-800 hover:bg-neutral-100 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${focusRing}`}
                >
                  <CheckCheck className="h-4 w-4" /> {en ? 'Mark all read' : 'Tandai dibaca'}
                </button>
                <button
                  type="button"
                  onClick={() => dialogRef.current?.close()}
                  aria-label={en ? 'Close' : 'Tutup'}
                  className={`w-9 h-9 flex items-center justify-center rounded-lg text-neutral-700 hover:text-neutral-950 hover:bg-neutral-100 cursor-pointer ${focusRing}`}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="px-5 pt-4">
              <div role="group" aria-label={en ? 'Filter notifications' : 'Filter notifikasi'} className="flex gap-1 overflow-x-auto rounded-xl border border-neutral-200 bg-neutral-100 p-1">
                {tabs.map(([id, label, n]) => (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={tab === id}
                    onClick={() => setTab(id)}
                    className={`flex-1 shrink-0 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition-colors cursor-pointer ${focusRing} ${
                      tab === id ? 'bg-white font-semibold text-neutral-950 shadow-xs' : 'text-neutral-700 hover:text-neutral-950'
                    }`}
                  >
                    {label} <span className="tabular-nums text-neutral-600">{n}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-5">
              {items === null ? (
                <p className="py-16 text-center text-sm text-neutral-700">
                  {en ? 'Notifications could not be loaded. Reload the page to try again.' : 'Notifikasi gagal dimuat. Muat ulang halaman untuk mencoba lagi.'}
                </p>
              ) : shown.length === 0 ? (
                <p className="py-16 text-center text-sm text-neutral-700">
                  {tab === 'unread'
                    ? en ? 'You are all caught up.' : 'Semua sudah dibaca.'
                    : en ? 'Nothing here yet. New models, top-ups and product updates show up here.' : 'Belum ada apa-apa. Model baru, top-up, dan update produk muncul di sini.'}
                </p>
              ) : (
                <ol className="relative ml-10 border-l border-dashed border-neutral-300 space-y-7">
                  {shown.map((n, i) => {
                    const c = content(n, en);
                    const label = dayLabel(n.at);
                    const firstOfDay = i === 0 || dayLabel(shown[i - 1]!.at) !== label;
                    const external = c.link && /^https?:\/\//.test(c.link.href);
                    return (
                      <li key={n.id} className="relative pl-12">
                        {firstOfDay ? (
                          // Day chip sits centred on the timeline line
                          <span className="absolute left-0 top-0.5 -translate-x-1/2 whitespace-nowrap rounded-full border border-neutral-300 bg-white px-2 py-0.5 text-[11px] font-medium text-neutral-800">
                            {label}
                          </span>
                        ) : (
                          <span aria-hidden="true" className="absolute -left-[3px] top-2 h-1.5 w-1.5 rounded-full bg-neutral-800" />
                        )}
                        <h3 className="flex items-center gap-2 text-base font-semibold text-neutral-950">
                          {isUnread(n) && <span className="h-2 w-2 shrink-0 rounded-full bg-red-600" aria-label={en ? 'Unread' : 'Belum dibaca'} />}
                          {c.title}
                        </h3>
                        {n.type === 'model_new' && <ModelBanner modelId={n.modelId} name={n.name} />}
                        <p className={`${n.type === 'model_new' ? 'mt-3' : 'mt-1.5'} whitespace-pre-line text-sm text-neutral-800`}>{c.body}</p>
                        {c.link &&
                          (external ? (
                            <a href={c.link.href} target="_blank" rel="noopener noreferrer" className={`mt-3 inline-flex h-9 items-center rounded-lg border border-neutral-300 px-3 text-sm font-semibold text-neutral-950 hover:bg-neutral-100 ${focusRing}`}>
                              {c.link.label}
                            </a>
                          ) : (
                            <Link href={c.link.href} onClick={() => dialogRef.current?.close()} className={`mt-3 inline-flex h-9 items-center rounded-lg border border-neutral-300 px-3 text-sm font-semibold text-neutral-950 hover:bg-neutral-100 ${focusRing}`}>
                              {c.link.label}
                            </Link>
                          ))}
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}
