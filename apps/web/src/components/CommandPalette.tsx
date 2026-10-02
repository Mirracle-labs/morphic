'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  Bot,
  Copy,
  Check,
  Compass,
  Code2,
  Globe,
  KeyRound,
  LayoutDashboard,
  Coins,
  FileText,
  Terminal,
  X,
  ArrowRight,
} from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { API_BASE_URL } from '@/lib/utils';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

interface PaletteItem {
  id: string;
  section: 'models' | 'navigation' | 'snippets' | 'locale';
  sectionLabel: string;
  title: string;
  subtitle?: string;
  badge?: string;
  icon: React.ComponentType<{ className?: string }>;
  onSelect: () => void;
  keywords?: string;
}

const emptySubscribe = () => () => {};

export default function CommandPalette({ isOpen, onClose }: CommandPaletteProps) {
  const router = useRouter();
  const { locale, setLocale } = useTranslation();
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const mounted = React.useSyncExternalStore(emptySubscribe, () => true, () => false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [models, setModels] = useState<
    Array<{ id: string; name: string; provider: string; contextLength: number | null; capabilities: string[] | null }>
  >([]);
  const modelsRequested = useRef(false);

  // Live catalog, fetched once on first open.
  useEffect(() => {
    if (!isOpen || modelsRequested.current) return;
    modelsRequested.current = true;
    fetch('/api/models')
      .then((r) => r.json())
      .then((body) => setModels(Array.isArray(body?.data) ? body.data : []))
      .catch(() => {
        modelsRequested.current = false; // allow a retry on next open
      });
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        setQuery('');
        setSelectedIndex(0);
        inputRef.current?.focus();
      }, 30);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (isOpen) onClose();
      } else if (e.key === 'Escape' && isOpen) {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const copyToClipboard = useCallback(
    (text: string, itemId: string) => {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        navigator.clipboard.writeText(text);
        setCopiedId(itemId);
        setTimeout(() => {
          setCopiedId(null);
          onClose();
        }, 700);
      }
    },
    [onClose]
  );

  const items: PaletteItem[] = useMemo(() => {
    const list: PaletteItem[] = [];

    models.forEach((m) => {
      const ctx = m.contextLength ? `${Math.round(m.contextLength / 1024)}K context` : null;
      list.push({
        id: `model-${m.id}`,
        section: 'models',
        sectionLabel: locale === 'en' ? 'AI Models' : 'Model AI',
        title: m.name,
        subtitle: [m.provider, ctx].filter(Boolean).join(' · '),
        badge: m.id,
        icon: Bot,
        keywords: `${m.name} ${m.provider} ${m.id} ${(m.capabilities ?? []).join(' ')}`,
        onSelect: () => {
          copyToClipboard(m.id, `model-${m.id}`);
        },
      });
    });

    const navs = [
      { path: '/', title: locale === 'en' ? 'Home' : 'Beranda', sub: locale === 'en' ? 'Landing page overview' : 'Ikhtisar halaman utama', icon: Compass },
      { path: '/models', title: locale === 'en' ? 'Model Catalog' : 'Katalog Model', sub: locale === 'en' ? 'Explore all AI models & pricing' : 'Eksplorasi seluruh model AI & tarif', icon: Bot },
      { path: '/pricing', title: locale === 'en' ? 'Pricing & Packages' : 'Harga & Paket Saldo', sub: locale === 'en' ? 'Pay-as-you-go credit packages' : 'Paket saldo top-up bayar sesuai pakai', icon: Coins },
      { path: '/docs', title: locale === 'en' ? 'Documentation' : 'Dokumentasi API', sub: locale === 'en' ? 'API schemas, SDKs & guides' : 'Skema API, SDK & panduan integrasi', icon: FileText },
      { path: '/dashboard', title: 'Dashboard', sub: locale === 'en' ? 'Overview metrics & stats' : 'Metrik ringkasan & statistik', icon: LayoutDashboard },
      { path: '/dashboard/keys', title: locale === 'en' ? 'API Keys' : 'Kunci API', sub: locale === 'en' ? 'Generate & manage secret tokens' : 'Buat & kelola token rahasia', icon: KeyRound },
      { path: '/dashboard/usage', title: locale === 'en' ? 'Usage & Logs' : 'Penggunaan & Log', sub: locale === 'en' ? 'Real-time telemetry and spend' : 'Telemetri real-time dan konsumsi saldo', icon: Terminal },
      { path: '/dashboard/billing', title: locale === 'en' ? 'Billing & Top-up' : 'Top-up Saldo QRIS', sub: locale === 'en' ? 'Instant QRIS payment & history' : 'Pembayaran QRIS instan & riwayat', icon: Coins },
    ];

    navs.forEach((n) => {
      list.push({
        id: `nav-${n.path}`,
        section: 'navigation',
        sectionLabel: locale === 'en' ? 'Navigation' : 'Navigasi',
        title: n.title,
        subtitle: n.sub,
        badge: n.path,
        icon: n.icon,
        keywords: `${n.title} ${n.sub} ${n.path}`,
        onSelect: () => {
          router.push(n.path);
          onClose();
        },
      });
    });

    list.push({
      id: 'snip-base-url',
      section: 'snippets',
      sectionLabel: locale === 'en' ? 'Quick Actions' : 'Tindakan Cepat',
      title: locale === 'en' ? 'Copy Base URL' : 'Salin Base URL',
      subtitle: API_BASE_URL,
      badge: 'OpenAI Schema',
      icon: Code2,
      keywords: 'base_url api endpoint url host morphic',
      onSelect: () => {
        copyToClipboard(API_BASE_URL, 'snip-base-url');
      },
    });

    list.push({
      id: 'snip-curl',
      section: 'snippets',
      sectionLabel: locale === 'en' ? 'Quick Actions' : 'Tindakan Cepat',
      title: locale === 'en' ? 'Copy cURL Snippet' : 'Salin Contoh cURL',
      subtitle: `curl ${API_BASE_URL}/chat/completions ...`,
      badge: 'Terminal',
      icon: Terminal,
      keywords: 'curl bash terminal request chat completions',
      onSelect: () => {
        const curl = `curl ${API_BASE_URL}/chat/completions \\\n  -H "Authorization: Bearer YOUR_MORPHIC_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model": "deepseek-v4", "messages": [{"role": "user", "content": "Hello Morphic"}]}'`;
        copyToClipboard(curl, 'snip-curl');
      },
    });

    list.push({
      id: 'snip-cursor',
      section: 'snippets',
      sectionLabel: locale === 'en' ? 'Quick Actions' : 'Tindakan Cepat',
      title: locale === 'en' ? 'Copy Cursor IDE Base URL' : 'Salin Base URL Cursor IDE',
      subtitle: locale === 'en' ? 'Paste in Cursor Settings > Models > OpenAI API Key' : 'Tempel di Pengaturan Cursor > Models > OpenAI API Key',
      badge: 'Cursor',
      icon: Code2,
      keywords: 'cursor ide windsurf cline setup config',
      onSelect: () => {
        copyToClipboard(API_BASE_URL, 'snip-cursor');
      },
    });

    list.push({
      id: 'locale-toggle',
      section: 'locale',
      sectionLabel: locale === 'en' ? 'Preferences' : 'Preferensi',
      title: locale === 'en' ? 'Ganti Bahasa ke Indonesia' : 'Switch Language to English',
      subtitle: locale === 'en' ? 'Tampilkan seluruh antarmuka dalam Bahasa Indonesia' : 'Display interface in English',
      badge: locale === 'en' ? 'ID' : 'EN',
      icon: Globe,
      keywords: 'language bahasa indonesia english locale translate',
      onSelect: () => {
        setLocale(locale === 'en' ? 'id' : 'en');
        onClose();
      },
    });

    return list;
  }, [models, locale, router, onClose, copyToClipboard, setLocale]);

  const filteredItems = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase().trim();
    return items.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        (item.subtitle && item.subtitle.toLowerCase().includes(q)) ||
        (item.badge && item.badge.toLowerCase().includes(q)) ||
        (item.keywords && item.keywords.toLowerCase().includes(q))
    );
  }, [items, query]);

  const handleKeyDownList = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % (filteredItems.length || 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filteredItems.length) % (filteredItems.length || 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filteredItems[selectedIndex]) {
        filteredItems[selectedIndex].onSelect();
      }
    }
  };

  useEffect(() => {
    if (!listRef.current) return;
    const activeEl = listRef.current.querySelector(`[data-index="${selectedIndex}"]`);
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  if (!isOpen || !mounted) return null;

  return createPortal(
    <AnimatePresence>
      <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-[14vh] sm:pt-[16vh] px-4">
        {/* Full-screen smooth backdrop blur covering 100% of viewport without clipping */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={onClose}
          className="fixed inset-0 bg-neutral-950/45 backdrop-blur-md"
        />

        {/* Solid, sharp Command Dialog Box (Linear/Raycast aesthetic) */}
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label="Command palette"
          initial={{ opacity: 0, scale: 0.98, y: -8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.98, y: -8 }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          onKeyDown={handleKeyDownList}
          className="relative w-full max-w-xl rounded-2xl border border-neutral-200 bg-white shadow-[0_24px_64px_-12px_rgba(0,0,0,0.22),0_0_0_1px_rgba(0,0,0,0.05)] overflow-hidden flex flex-col z-10"
        >
          {/* Top Search Input Bar */}
          <div className="flex items-center gap-3 px-4.5 py-3.5 border-b border-neutral-100 bg-white">
            <Search className="w-4 h-4 text-neutral-500 shrink-0" />
            <input
              ref={inputRef}
              type="text"
              aria-label={
                locale === 'en'
                  ? 'Search models, docs, actions, or jump to page'
                  : 'Cari model, dokumen, aksi, atau buka halaman'
              }
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelectedIndex(0);
              }}
              placeholder={
                locale === 'en'
                  ? 'Search models, docs, actions, or jump to page...'
                  : 'Cari model, docs, tindakan, atau buka halaman...'
              }
              className="w-full bg-transparent text-sm font-medium text-neutral-900 placeholder:text-neutral-500 focus:outline-hidden"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="p-1 rounded-md text-neutral-500 hover:text-neutral-700 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
            <kbd className="hidden sm:inline-block px-1.5 py-0.5 rounded bg-neutral-100 border border-neutral-200 text-[10px] font-mono font-medium text-neutral-500">
              ESC
            </kbd>
          </div>

          {/* Results List */}
          <div
            ref={listRef}
            className="max-h-[380px] overflow-y-auto p-2 scrollbar-thin scrollbar-thumb-neutral-200"
          >
            {filteredItems.length === 0 ? (
              <div className="py-12 text-center text-xs font-mono text-neutral-500">
                {locale === 'en' ? `No results found for "${query}"` : `Tidak ada hasil untuk "${query}"`}
              </div>
            ) : (
              filteredItems.map((item, idx) => {
                const isSelected = selectedIndex === idx;
                const isCopied = copiedId === item.id;
                const Icon = item.icon;

                return (
                  <button
                    key={item.id}
                    data-index={idx}
                    type="button"
                    onClick={item.onSelect}
                    onMouseEnter={() => setSelectedIndex(idx)}
                    className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl text-left transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-neutral-100/90 text-neutral-950 font-medium'
                        : 'text-neutral-700 hover:bg-neutral-50'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border transition-colors ${
                          isSelected
                            ? 'bg-white border-neutral-300 text-neutral-900 shadow-2xs'
                            : 'bg-neutral-50 border-neutral-200 text-neutral-500'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                      </div>

                      <div className="min-w-0 flex flex-col">
                        <div className="flex items-center gap-2">
                          <span className="text-xs sm:text-sm font-semibold text-neutral-900 truncate">
                            {item.title}
                          </span>
                          {item.badge && (
                            <span className="px-1.5 py-0.5 rounded font-mono text-[9px] font-semibold uppercase tracking-wider bg-neutral-100 text-neutral-600 border border-neutral-200">
                              {item.badge}
                            </span>
                          )}
                        </div>
                        {item.subtitle && (
                          <span className="text-[11px] text-neutral-500 truncate mt-0.5">
                            {item.subtitle}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="shrink-0 flex items-center gap-2 pl-2">
                      {isCopied ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-mono font-bold text-emerald-600">
                          <Check className="w-3.5 h-3.5" />
                          <span>{locale === 'en' ? 'Copied!' : 'Tersalin!'}</span>
                        </span>
                      ) : item.section === 'models' || item.section === 'snippets' ? (
                        <Copy
                          className={`w-3.5 h-3.5 ${
                            isSelected ? 'text-neutral-700' : 'text-neutral-300'
                          }`}
                        />
                      ) : (
                        <ArrowRight
                          className={`w-3.5 h-3.5 ${
                            isSelected ? 'text-neutral-700' : 'text-neutral-300'
                          }`}
                        />
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Footer Navigation Hints */}
          <div className="flex items-center justify-between px-4 py-2.5 border-t border-neutral-100 bg-neutral-50/70 text-[11px] font-mono text-neutral-500">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1">
                <kbd className="px-1 py-0.5 rounded bg-white border border-neutral-200 text-[9px] font-medium text-neutral-600">
                  ↑↓
                </kbd>
                <span>{locale === 'en' ? 'Navigate' : 'Navigasi'}</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <kbd className="px-1.5 py-0.5 rounded bg-white border border-neutral-200 text-[9px] font-medium text-neutral-600">
                  ↵
                </kbd>
                <span>{locale === 'en' ? 'Select / Copy' : 'Pilih / Salin'}</span>
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span>Morphic</span>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>,
    document.body
  );
}
