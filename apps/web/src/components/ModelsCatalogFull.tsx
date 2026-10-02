'use client';

import React, { useState, useMemo } from 'react';
import { ALL_MODELS, ModelItem } from '@/lib/models-data';
import ModelCard from './ModelCard';
import { useTranslation } from '@/lib/i18n';
import { Search, SlidersHorizontal, Bot } from 'lucide-react';

export default function ModelsCatalogFull({ isLoggedIn = false }: { isLoggedIn?: boolean }) {
  const { t, locale } = useTranslation();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');

  const categories = [
    { key: 'All', label: t.models.filterAll },
    { key: 'Coding', label: t.models.filterCoding },
    { key: 'Reasoning', label: t.models.filterReasoning },
    { key: 'Chat', label: t.models.filterChat },
    { key: 'Multimodal', label: t.models.filterMultimodal },
  ];

  const filteredModels = useMemo(() => {
    return ALL_MODELS.filter((model) => {
      const matchCategory =
        selectedCategory === 'All' || model.category.toLowerCase() === selectedCategory.toLowerCase();

      const q = searchQuery.toLowerCase().trim();
      const matchSearch =
        !q ||
        model.name.toLowerCase().includes(q) ||
        model.id.toLowerCase().includes(q) ||
        model.provider.toLowerCase().includes(q);

      return matchCategory && matchSearch;
    });
  }, [selectedCategory, searchQuery]);

  return (
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 pt-32 pb-24">
      {/* Header Section */}
      <div className="text-center max-w-3xl mx-auto mb-12">
        <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-neutral-100 border border-neutral-200 text-neutral-800 text-xs font-semibold mb-4 shadow-sm">
          <Bot className="h-3.5 w-3.5 text-neutral-950" />
          <span>{t.models.badge}</span>
        </div>

        <h1 className="text-4xl sm:text-5xl font-heading font-extrabold tracking-tight mb-4 text-neutral-950">
          {t.models.title}
        </h1>

        <p className="text-neutral-600 font-body text-sm sm:text-base leading-relaxed max-w-2xl mx-auto">
          {t.models.desc}
        </p>
      </div>

      {/* Search Bar & Category Filters */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 mb-10">
        {/* Search Input */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t.models.searchPlaceholder}
            aria-label={t.models.searchPlaceholder}
            className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-neutral-300 bg-white text-xs sm:text-sm text-neutral-900 placeholder:text-neutral-500 focus:outline-none focus:ring-2 focus:ring-neutral-950 focus:border-transparent transition-all shadow-sm"
          />
        </div>

        {/* Category Filter Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
          {categories.map((cat) => (
            <button
              key={cat.key}
              onClick={() => setSelectedCategory(cat.key)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                selectedCategory === cat.key
                  ? 'bg-neutral-950 text-white shadow-sm'
                  : 'bg-white border border-neutral-200 text-neutral-600 hover:bg-neutral-100 hover:text-neutral-950'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {/* Result Count Banner */}
      <div className="flex items-center justify-between text-xs text-neutral-500 mb-6 font-mono">
        <span>
          {filteredModels.length} {t.models.modelsCount}
        </span>
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="text-neutral-900 underline hover:text-black cursor-pointer"
          >
            {locale === 'id' ? 'Hapus pencarian' : 'Clear search'}
          </button>
        )}
      </div>

      {/* Models Grid Container with stable min-height to prevent footer from jumping up/down on filter change */}
      <div className="min-h-[580px] sm:min-h-[640px] transition-all duration-300">
        {filteredModels.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 items-start">
            {filteredModels.map((model) => (
              <ModelCard key={model.id} model={model} isLoggedIn={isLoggedIn} />
            ))}
          </div>
        ) : (
          <div className="text-center py-20 bg-white rounded-3xl border border-neutral-200/90 p-8 max-w-md mx-auto">
            <p className="text-neutral-600 text-sm mb-4 font-body">{t.models.noResults}</p>
            <button
              onClick={() => {
                setSearchQuery('');
                setSelectedCategory('All');
              }}
              className="px-4 py-2 rounded-xl bg-neutral-950 text-white text-xs font-semibold hover:bg-neutral-800 transition-colors cursor-pointer"
            >
              {locale === 'id' ? 'Reset Filter' : 'Reset Filters'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
