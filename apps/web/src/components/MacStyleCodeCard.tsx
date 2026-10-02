'use client';

import { useState } from 'react';
import { Copy, Check, Sparkles } from 'lucide-react';

const SNIPPETS = {
  cursor: {
    label: 'Cursor IDE',
    desc: 'Pengaturan di Cursor Settings > Models > OpenAI API Key & Base URL',
    code: `// Settings > Models > OpenAI API:
Base URL: https://api.morphic.xxx/v1
API Key:  mp-xxxxxxxxxxxxxxxxxxxx

// Model names yang langsung didukung:
- deepseek-v4
- qwen-max
- kimi-coding`,
  },
  cline: {
    label: 'Cline / VSCode',
    desc: 'Pengaturan di Cline Settings > Provider: OpenAI Compatible',
    code: `{
  "apiProvider": "openai",
  "openAiBaseUrl": "https://api.morphic.xxx/v1",
  "openAiApiKey": "mp-xxxxxxxxxxxxxxxxxxxx",
  "openAiModelId": "deepseek-v4"
}`,
  },
  python: {
    label: 'Python SDK',
    desc: 'Gunakan pustaka resmi openai tanpa perlu install SDK baru',
    code: `from openai import OpenAI

client = OpenAI(
    base_url="https://api.morphic.xxx/v1",
    api_key="mp-xxxxxxxxxxxxxxxxxxxx",
)

response = client.chat.completions.create(
    model="deepseek-v4",
    messages=[{"role": "user", "content": "Tuliskan kode auth TypeScript"}]
)
print(response.choices[0].message.content)`,
  },
  curl: {
    label: 'cURL',
    desc: 'Uji langsung via terminal atau webhook backend',
    code: `curl https://api.morphic.xxx/v1/chat/completions \\
  -H "Authorization: Bearer mp-xxxxxxxxxxxxxxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "deepseek-v4",
    "messages": [{"role": "user", "content": "Halo AI!"}]
  }'`,
  },
};

type TabKey = keyof typeof SNIPPETS;

function highlightCode(code: string, language: string) {
  const lines = code.split('\n');
  const isJson = language === 'json';
  const isPython = language === 'python';
  const isBash = language === 'bash';
  const isConfig = language === 'config';

  return lines.map((line, i) => {
    let highlighted = line
      .replace(/("([^"\\]|\\.)*")\s*:/g, '<span class="token key">$1</span>:')
      .replace(/:\s*("([^"\\]|\\.)*")/g, ': <span class="token string">$1</span>')
      .replace(/\b(\d+\.?\d*)\b/g, '<span class="token number">$1</span>')
      .replace(/\b(true|false|null)\b/g, '<span class="token keyword">$1</span>')
      .replace(/\b(from|import|def|class|return|print|as|with|open)\b/g, '<span class="token keyword">$1</span>')
      .replace(/\b(OpenAI|client|response|model|messages|role|content)\b/g, '<span class="token function">$1</span>')
      .replace(/#.*$/g, '<span class="token comment">$&</span>')
      .replace(/\/\/.*$/g, '<span class="token comment">$&</span>')
      .replace(/(curl|https?:\/\/[^\s]+)/g, '<span class="token url">$1</span>')
      .replace(/-H\s+("[^"]*")/g, '-H <span class="token string">$1</span>')
      .replace(/-d\s+('[^']*')/g, '-d <span class="token string">$1</span>')
      .replace(/\b(mp-[a-z0-9]+)\b/g, '<span class="token apikey">$1</span>');

    return (
      <span key={i} className="block">
        {highlighted.split(/(<span class="token \w+">.*?<\/span>)/).map((part, j) => {
          if (part.startsWith('<span')) {
            return <span key={j} dangerouslySetInnerHTML={{ __html: part }} />;
          }
          return part;
        })}
        <br />
      </span>
    );
  });
}

export default function MacStyleCodeCard() {
  const [activeTab, setActiveTab] = useState<TabKey>('cursor');
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(SNIPPETS[activeTab].code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const getLanguage = (tab: TabKey) => {
    switch (tab) {
      case 'cline': return 'json';
      case 'python': return 'python';
      case 'curl': return 'bash';
      default: return 'config';
    }
  };

  return (
    <section className="relative z-10 py-24 px-4 sm:px-6 bg-white text-neutral-900 border-t border-neutral-200/80 content-deferred">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-12">
          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-neutral-100 border border-neutral-200 text-neutral-800 text-xs font-semibold mb-4 shadow-sm">
            <Sparkles className="h-3.5 w-3.5 text-neutral-900" />
            <span>Setup 1 Menit</span>
          </div>

          <h2 className="text-3xl md:text-5xl font-heading font-extrabold tracking-tight mb-4 text-neutral-950">
            Kompatibel Penuh Tanpa Perlu Ubah Workflow.
          </h2>

          <p className="text-neutral-600 font-body text-sm md:text-base max-w-xl mx-auto">
            Cukup ganti Base URL ke endpoint Morphic dan masukkan API Key Anda. Langsung jalan di
            Cursor, VS Code Cline, Windsurf, maupun backend Anda.
          </p>
        </div>

        {/* Mac-style Code Card */}
        <div className="max-w-3xl mx-auto">
          <div className="bg-white rounded-2xl border border-neutral-200 shadow-xl overflow-hidden">
            {/* Window Controls Bar */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200 bg-neutral-50">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-red-400 shadow-[0_1px_0_0_rgba(255,96,92,0.5)]" />
                <span className="w-3 h-3 rounded-full bg-yellow-400 shadow-[0_1px_0_0_rgba(255,189,68,0.5)]" />
                <span className="w-3 h-3 rounded-full bg-green-400 shadow-[0_1px_0_0_rgba(0,202,78,0.5)]" />
              </div>
              <div className="flex items-center gap-2">
                {(Object.keys(SNIPPETS) as TabKey[]).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                      activeTab === tab
                        ? 'bg-neutral-900 text-white shadow-sm'
                        : 'text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100'
                    }`}
                  >
                    {SNIPPETS[tab].label}
                  </button>
                ))}
              </div>
            </div>

            {/* Tab Description */}
            <div className="px-4 py-3 text-xs text-neutral-600 font-body bg-neutral-50 border-b border-neutral-200">
              {SNIPPETS[activeTab].desc}
            </div>

            {/* Code Area */}
            <div className="p-4 md:p-6 bg-white relative">
              <pre className="text-xs md:text-sm font-mono text-neutral-800 overflow-x-auto leading-relaxed selection:bg-neutral-200 selection:text-neutral-900">
                <code className="text-neutral-800">
                  {highlightCode(SNIPPETS[activeTab].code, getLanguage(activeTab))}
                </code>
              </pre>
              <button
                onClick={handleCopy}
                className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-200 text-xs font-medium text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 hover:border-neutral-300 cursor-pointer shadow-sm"
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5 text-emerald-500" />
                    <span className="text-emerald-500">Tersalin!</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5 text-neutral-400" />
                    <span>Salin</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        <style jsx global>{`
          .token.comment { color: #6b7280; font-style: italic; }
          .token.keyword { color: #7c3aed; font-weight: 600; }
          .token.function { color: #2563eb; }
          .token.string { color: #059669; }
          .token.number { color: #dc2626; }
          .token.url { color: #ea580c; }
          .token.apikey { color: #db2777; font-family: monospace; background: #fdf2f8; padding: 0 2px; border-radius: 3px; }
          .token.key { color: #3730a3; }
        `}</style>
      </div>
    </section>
  );
}