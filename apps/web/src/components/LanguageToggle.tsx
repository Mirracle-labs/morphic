'use client';

import { useTranslation } from '@/lib/i18n';

export function LanguageToggle() {
  const { locale, setLocale } = useTranslation();

  return (
    <div className="inline-flex items-center p-0.5 rounded-full border border-neutral-200 bg-neutral-100 text-[11px] font-mono select-none">
      <button
        type="button"
        onClick={() => setLocale('id')}
        aria-pressed={locale === 'id'}
        aria-label="Switch to Indonesian"
        className={`px-2.5 py-1 rounded-full transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 ${
          locale === 'id'
            ? 'bg-white text-neutral-950 shadow-2xs font-bold'
            : 'text-neutral-500 hover:text-neutral-900 font-medium'
        }`}
        title="Bahasa Indonesia"
      >
        ID
      </button>
      <button
        type="button"
        onClick={() => setLocale('en')}
        aria-pressed={locale === 'en'}
        aria-label="Switch to English"
        className={`px-2.5 py-1 rounded-full transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 ${
          locale === 'en'
            ? 'bg-white text-neutral-950 shadow-2xs font-bold'
            : 'text-neutral-500 hover:text-neutral-900 font-medium'
        }`}
        title="English"
      >
        EN
      </button>
    </div>
  );
}
