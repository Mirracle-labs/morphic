'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Bell, CheckCheck, X } from 'lucide-react';
import { formatCredits } from '@/lib/utils';
import type { NotificationItem } from '@/lib/notifications';
import { getNotificationsAction } from '@/lib/actions';
import { useLocalStorage } from '@/lib/use-local-storage';

type Tab = 'all' | 'unread' | 'model' | 'changelog' | 'account';

// ponytail: read state is per-browser (localStorage). Move to a users column if it must sync across devices.
const SEEN_KEY = 'morphic:notifications-seen';

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950';

const money = (cents: number, currency: string) =>
  currency === 'USD' ? `$${(cents / 100).toFixed(2)}` : `Rp ${cents.toLocaleString('id-ID')}`;

function content(n: NotificationItem, en: boolean): { title: string; body: string; link?: { href: string; label: string } } {
  switch (n.type) {
    case 'model_new':
      return {
        title: `${en ? 'New model available' : 'Model baru tersedia'}: ${n.name}`,
        body: n.description ?? (en ? `${n.modelId} is now live on the gateway.` : `${n.modelId} sudah aktif di gateway.`),
        link: { href: '/models', label: en ? 'View in catalog' : 'Lihat di katalog' },
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

  const list = items ?? [];
  const isUnread = (n: NotificationItem) => !seen || n.at > seen;
  const unread = list.filter(isUnread);

  const markAllRead = () => setSeen(new Date().toISOString());

  const tabs: [Tab, string, number][] = [
    ['all', en ? 'All' : 'Semua', list.length],
    ['unread', en ? 'Unread' : 'Belum dibaca', unread.length],
    ['model', en ? 'Models' : 'Model', list.filter((n) => n.kind === 'model').length],
    ['changelog', 'Changelog', list.filter((n) => n.kind === 'changelog').length],
    ['account', en ? 'Account' : 'Akun', list.filter((n) => n.kind === 'account').length],
  ];
  const shown = tab === 'all' ? list : tab === 'unread' ? unread : list.filter((n) => n.kind === tab);

  const dayLabel = (iso: string) => {
    const key = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
    const d = new Date(iso);
    if (key(d) === key(new Date())) return en ? 'Today' : 'Hari ini';
    if (key(d) === key(new Date(Date.now() - 86_400_000))) return en ? 'Yesterday' : 'Kemarin';
    return d.toLocaleDateString(en ? 'en-US' : 'id-ID', { month: 'short', day: 'numeric', timeZone: 'Asia/Jakarta' });
  };

  return (
    <>
      <button
        type="button"
        onClick={() => {
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
        onClick={(e) => e.target === dialogRef.current && dialogRef.current?.close()}
        className="m-0 ml-auto h-dvh max-h-dvh w-full max-w-xl bg-white p-0 shadow-2xl backdrop:bg-black/40"
      >
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
                      <p className="mt-1.5 whitespace-pre-line text-sm text-neutral-800">{c.body}</p>
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
      </dialog>
    </>
  );
}
