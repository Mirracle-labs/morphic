'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ModelItem, getModelDailyRate, getModelBadge } from '@/lib/models-data';
import { ModelProviderLogo } from './ProviderLogos';
import { useTranslation } from '@/lib/i18n';
import { Check, Copy, ArrowUpRight, Clock } from 'lucide-react';

interface ModelCardProps {
  model: ModelItem;
  isLoggedIn?: boolean;
}

export default function ModelCard({ model, isLoggedIn = false }: ModelCardProps) {
  const { locale, t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const desc = model.description[locale] || model.description.id;

  const handleCopyId = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(model.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const badgeText = getModelBadge(model, locale);

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white p-6 flex flex-col justify-between hover:border-neutral-300 hover:shadow-xl transition-all duration-200 group relative">
      {/* Top Bar: Provider Logo + Provider Name + Optional Badge */}
      <div>
        <div className="flex items-center justify-between gap-2 mb-4 h-8">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-white border border-neutral-200 flex items-center justify-center shrink-0">
              <ModelProviderLogo provider={model.provider} className="w-5 h-5" />
            </div>
            <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wider truncate">
              {model.provider}
            </span>
          </div>

          {badgeText && (
            <span
              className={`shrink-0 whitespace-nowrap px-2.5 py-0.5 rounded-full text-[10px] font-mono font-medium tracking-wide ${
                model.badgeType === 'pro' || model.badgeType === 'popular' || model.badgeType === 'flagship'
                  ? 'bg-neutral-950 text-white shadow-2xs'
                  : 'bg-neutral-100 text-neutral-700 border border-neutral-200/90'
              }`}
            >
              {badgeText}
            </span>
          )}
        </div>

        {/* Model Name & ID */}
        <h3 className="font-heading font-extrabold text-lg text-neutral-950 mb-1 group-hover:text-black tracking-tight">
          {model.name}
        </h3>

        <div className="flex items-center gap-2 mb-3">
          <button
            onClick={handleCopyId}
            className="flex items-center gap-1.5 text-[11px] text-neutral-500 hover:text-neutral-900 transition-colors py-1"
            title={model.id}
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? (locale === 'id' ? 'Tersalin' : 'Copied') : (locale === 'id' ? 'Salin ID model' : 'Copy model ID')}</span>
          </button>
        </div>

        {/* Short Useful Description */}
        <p className="text-xs text-neutral-600 font-body leading-relaxed line-clamp-2 h-9 mb-6">
          {desc}
        </p>
      </div>

      {/* Daily rate, context window, and action */}
      <div>
        <div className="grid grid-cols-1 gap-3 mb-5 bg-neutral-50 p-3.5 rounded-xl">
          {/* Price Section */}
          <div>
            <span className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wider block mb-1">
              {t.models.priceLabel}
            </span>
            <span className="text-xs font-bold text-neutral-900 font-mono">
              {getModelDailyRate(model, locale)}
            </span>
          </div>

          {/* Context Window Section */}
          <div>
            <span className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wider block mb-1 flex items-center gap-1">
              <Clock className="w-3 h-3 text-neutral-500" />
              <span>{t.models.contextLabel}</span>
            </span>
            <span className="text-xs font-semibold text-neutral-800 font-mono">
              {model.contextWindow}
            </span>
          </div>
        </div>

        {/* Action Button: Use Model */}
        <Link
          href={isLoggedIn ? '/dashboard/keys' : '/login'}
          className="w-full py-2.5 px-4 rounded-xl bg-neutral-950 hover:bg-neutral-800 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer shadow-sm group/btn"
        >
          <span>{t.models.useModel}</span>
          <ArrowUpRight className="w-3.5 h-3.5 transition-transform group-hover/btn:translate-x-0.5 group-hover/btn:-translate-y-0.5" />
        </Link>
      </div>
    </div>
  );
}
