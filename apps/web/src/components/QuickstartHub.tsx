'use client';

import { useState } from 'react';
import { Check, Copy, Terminal } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { API_BASE_URL } from '@/lib/utils';

const BASE_URL = API_BASE_URL;

type TabId = 'ide' | 'curl' | 'sdk';

function CopyButton({ text, locale }: { text: string; locale: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={locale === 'en' ? 'Copy snippet' : 'Salin kode'}
      className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-800 px-2.5 py-1 text-[11px] font-semibold text-neutral-300 transition-colors hover:bg-neutral-700 hover:text-white cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950"
    >
      {copied ? (
        <Check className="h-3 w-3 text-emerald-400" />
      ) : (
        <Copy className="h-3 w-3" />
      )}
      <span suppressHydrationWarning>
        {copied
          ? (locale === 'en' ? 'Copied' : 'Tersalin')
          : (locale === 'en' ? 'Copy' : 'Salin')}
      </span>
    </button>
  );
}

export default function QuickstartHub() {
  const { t, locale } = useTranslation();
  const [activeTab, setActiveTab] = useState<TabId>('ide');
  const [sdkLang, setSdkLang] = useState<'node' | 'python'>('node');

  const tabs: Array<{ id: TabId; label: string }> = [
    { id: 'ide', label: t.dashboard.quickstartTabIde },
    { id: 'curl', label: t.dashboard.quickstartTabCurl },
    { id: 'sdk', label: t.dashboard.quickstartTabSdk },
  ];

  const curlSnippet = `curl ${BASE_URL}/chat/completions \\
  -H "Authorization: Bearer $MORPHIC_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "deepseek-v4", "messages": [{"role": "user", "content": "Hello Morphic"}]}'`;

  const nodeSnippet = `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${BASE_URL}",
  apiKey: process.env.MORPHIC_API_KEY,
});

const res = await client.chat.completions.create({
  model: "deepseek-v4",
  messages: [{ role: "user", content: "Hello Morphic" }],
});`;

  const pythonSnippet = `import os
from openai import OpenAI

client = OpenAI(
    base_url="${BASE_URL}",
    api_key=os.environ["MORPHIC_API_KEY"],
)

res = client.chat.completions.create(
    model="deepseek-v4",
    messages=[{"role": "user", "content": "Hello Morphic"}],
)`;

  return (
    <div className="rounded-3xl border border-neutral-200/90 bg-white shadow-xs overflow-hidden h-full flex flex-col">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 pt-6 pb-4">
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-neutral-500" />
          <h2 suppressHydrationWarning className="font-heading font-bold text-base text-neutral-950">
            {t.dashboard.quickstartHubTitle}
          </h2>
        </div>
        <div className="flex items-center gap-1 bg-neutral-100 p-1 rounded-xl overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all duration-150 active:scale-95 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 ${
                activeTab === tab.id
                  ? 'bg-white text-neutral-950 shadow-2xs font-bold'
                  : 'text-neutral-600 hover:text-neutral-950'
              }`}
            >
              <span suppressHydrationWarning>{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="px-6 pb-6 flex-1 flex flex-col justify-between">
        <p suppressHydrationWarning className="text-xs text-neutral-500 mb-4">
          {activeTab === 'ide' && t.dashboard.quickstartIdeDesc}
          {activeTab === 'curl' && t.dashboard.quickstartCurlDesc}
          {activeTab === 'sdk' && t.dashboard.quickstartSdkDesc}
        </p>

        {activeTab === 'ide' && (
          <div className="rounded-2xl bg-neutral-950 border border-neutral-800 p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3 mb-3">
              <span suppressHydrationWarning className="text-[11px] text-neutral-500">
                {locale === 'id'
                  ? 'Buka Settings AI di Cursor / Cline, lalu isi:'
                  : 'Open the AI settings in Cursor / Cline, then fill in:'}
              </span>
              <CopyButton
                text={`Base URL: ${BASE_URL}\nModel: deepseek-v4\nAPI Key: mp-live-xxxxxxxx`}
                locale={locale}
              />
            </div>
            <div className="space-y-2.5 font-mono text-xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 rounded-lg bg-neutral-900 border border-neutral-800 px-3 py-2">
                <span className="text-neutral-500">Base URL</span>
                <span className="text-emerald-400 break-all">{BASE_URL}</span>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 rounded-lg bg-neutral-900 border border-neutral-800 px-3 py-2">
                <span className="text-neutral-500">Model</span>
                <span className="text-emerald-400">deepseek-v4</span>
              </div>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 rounded-lg bg-neutral-900 border border-neutral-800 px-3 py-2">
                <span className="text-neutral-500">API Key</span>
                <span className="text-neutral-300">mp-live-xxxxxxxx</span>
              </div>
            </div>
            <p suppressHydrationWarning className="text-[11px] text-neutral-500 mt-3">
              {t.dashboard.quickstartIdeKeyHint}
            </p>
          </div>
        )}

        {activeTab === 'curl' && (
          <div className="rounded-2xl bg-neutral-950 border border-neutral-800 p-4 sm:p-5">
            <div className="flex justify-end mb-2">
              <CopyButton text={curlSnippet} locale={locale} />
            </div>
            <pre className="text-xs font-mono text-neutral-200 leading-relaxed overflow-x-auto">
              {curlSnippet}
            </pre>
          </div>
        )}

        {activeTab === 'sdk' && (
          <div className="rounded-2xl bg-neutral-950 border border-neutral-800 p-4 sm:p-5">
            <div className="flex items-center justify-between mb-3 gap-2">
              <div className="inline-flex items-center gap-1 bg-neutral-900 border border-neutral-800 p-1 rounded-lg">
                <button
                  type="button"
                  onClick={() => setSdkLang('node')}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-mono transition-colors cursor-pointer ${
                    sdkLang === 'node'
                      ? 'bg-neutral-800 text-white font-semibold shadow-xs'
                      : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  Node.js / TS
                </button>
                <button
                  type="button"
                  onClick={() => setSdkLang('python')}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-mono transition-colors cursor-pointer ${
                    sdkLang === 'python'
                      ? 'bg-neutral-800 text-white font-semibold shadow-xs'
                      : 'text-neutral-400 hover:text-neutral-200'
                  }`}
                >
                  Python
                </button>
              </div>
              <CopyButton text={sdkLang === 'node' ? nodeSnippet : pythonSnippet} locale={locale} />
            </div>
            <pre className="text-xs font-mono text-neutral-200 leading-relaxed overflow-x-auto max-h-[220px]">
              {sdkLang === 'node' ? nodeSnippet : pythonSnippet}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
