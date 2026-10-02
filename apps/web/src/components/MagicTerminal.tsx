'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, useInView } from 'framer-motion';
import { Copy, Check, Terminal as TerminalIcon } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { useReducedMotionSafe } from '@/lib/use-reduced-motion-safe';
import { API_BASE_URL, CHAT_COMPLETIONS_URL } from '@/lib/utils';

type TabKey = 'cursor' | 'cline' | 'python' | 'curl';

// Characters revealed per frame; a ~200-char command types in about a second.
const CHARS_PER_FRAME = 3;
const OUTPUT_LINE_DELAY = 110;

const TERMINAL_SNIPPETS: Record<
  TabKey,
  {
    label: string;
    file: string;
    command: string;
    outputLines: string[];
    rawSnippet: string;
  }
> = {
  cursor: {
    label: 'Cursor IDE',
    file: 'cursor.settings.json',
    command: 'cursor settings apply --provider openai',
    outputLines: [
      `✔ Base URL: ${API_BASE_URL}`,
      '✔ API Key:  mp-xxxxxxxxxxxxxxxxxxxx',
      '✔ Models: deepseek-v4, kimi-coding, qwen-max, DeepSeek-V4-Flash-0731',
      '✔ Status: OpenAI-compatible ready for composer',
    ],
    rawSnippet: `// Cursor Settings > Models > OpenAI API:
Base URL: ${API_BASE_URL}
API Key:  mp-xxxxxxxxxxxxxxxxxxxx

// Models supported:
- deepseek-v4
- kimi-coding
- qwen-max
- DeepSeek-V4-Flash-0731`,
  },
  cline: {
    label: 'Cline / VSCode',
    file: 'cline_mcp_settings.json',
    command: 'cline settings apply cline_mcp_settings.json',
    outputLines: [
      '✔ apiProvider: openai',
      `✔ openAiBaseUrl: ${API_BASE_URL}`,
      '✔ openAiApiKey: mp-xxxxxxxxxxxxxxxxxxxx',
      '✔ openAiModelId: deepseek-v4',
      '✔ Provider ready. Start chatting in VSCode',
    ],
    rawSnippet: `{
  "apiProvider": "openai",
  "openAiBaseUrl": "${API_BASE_URL}",
  "openAiApiKey": "mp-xxxxxxxxxxxxxxxxxxxx",
  "openAiModelId": "deepseek-v4"
}`,
  },
  python: {
    label: 'Python SDK',
    file: 'quickstart.py',
    command: 'python -m pip install openai -q && python quickstart.py',
    outputLines: [
      '>>> Morphic Client Initialized...',
      '>>> Sending prompt to model="deepseek-v4"',
      '<<< [Response 200 OK]: "Here is your clean TypeScript auth module..."',
      '✔ Completed in 184ms | Tokens: 42 in / 158 out',
    ],
    rawSnippet: `from openai import OpenAI

client = OpenAI(
    base_url="${API_BASE_URL}",
    api_key="mp-xxxxxxxxxxxxxxxxxxxx",
)

response = client.chat.completions.create(
    model="deepseek-v4",
    messages=[{"role": "user", "content": "Write TypeScript auth helper"}]
)
print(response.choices[0].message.content)`,
  },
  curl: {
    label: 'cURL',
    file: 'request.sh',
    command: `curl ${CHAT_COMPLETIONS_URL} \\
  -H "Authorization: Bearer mp-xxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "deepseek-v4", "messages": [{"role": "user", "content": "Hello"}]}'`,
    outputLines: [
      'HTTP/2 200 OK',
      'content-type: application/json',
      'x-morphic-latency: 142ms',
      '{"id":"chatcmpl-9x","choices":[{"message":{"role":"assistant","content":"Hello! How can I help you?"}}]}',
    ],
    rawSnippet: `curl ${CHAT_COMPLETIONS_URL} \\
  -H "Authorization: Bearer mp-xxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "deepseek-v4", "messages": [{"role": "user", "content": "Hello"}]}'`,
  },
};

export default function MagicTerminal() {
  const { t } = useTranslation();
  const reduced = useReducedMotionSafe();
  const [activeTab, setActiveTab] = useState<TabKey>('curl');
  const [copied, setCopied] = useState(false);
  const [typed, setTypedCount] = useState(0);
  const [shownLines, setVisibleLines] = useState(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inView = useInView(bodyRef, { once: true, margin: '-80px' });

  const snippet = TERMINAL_SNIPPETS[activeTab];
  const command = snippet.command;
  const outputLines = snippet.outputLines;
  // Reduced motion: show everything at once.
  const typedCount = reduced ? command.length : typed;
  const visibleLines = reduced ? outputLines.length : shownLines;
  const typing = typedCount < command.length;

  // Types the command once per tab (no loop), then reveals the output lines.
  useEffect(() => {
    if (!inView || reduced) return;
    let raf = 0;
    let timer = 0;
    let n = 0;
    const type = () => {
      n = Math.min(n + CHARS_PER_FRAME, command.length);
      setTypedCount(n);
      if (n < command.length) raf = requestAnimationFrame(type);
      else reveal(1);
    };
    const reveal = (line: number) => {
      setVisibleLines(line);
      if (line < outputLines.length) timer = window.setTimeout(() => reveal(line + 1), OUTPUT_LINE_DELAY);
    };
    raf = requestAnimationFrame(type);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [inView, reduced, command, outputLines]);

  const handleTabChange = (tab: TabKey) => {
    setActiveTab(tab);
    setTypedCount(0);
    setVisibleLines(0);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(snippet.rawSnippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section id="terminal" className="relative z-10 py-14 lg:py-20 px-6 bg-white text-neutral-900 border-t border-neutral-200/70 scroll-mt-20 sm:scroll-mt-24">
      <div className="max-w-6xl mx-auto grid lg:grid-cols-[0.9fr_1.1fr] gap-10 lg:gap-14 items-center">
        {/* Left Column: Editorial Value Proposition */}
        <motion.div
          initial={reduced ? false : { opacity: 0, y: 14 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-50px' }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-col items-start"
        >
          <div className="text-xs sm:text-sm font-mono uppercase tracking-[0.2em] text-neutral-500 font-bold mb-3">
            {t.terminal.badge}
          </div>

          <h2 className="text-4xl sm:text-5xl lg:text-6xl font-heading font-extrabold tracking-tight mb-4 text-neutral-950">
            {t.terminal.title}
          </h2>

          <p className="text-neutral-600 font-body text-base sm:text-lg leading-relaxed mb-8 max-w-lg">
            {t.terminal.desc}
          </p>

          {/* Feature Pills */}
          <div className="flex flex-wrap gap-2.5">
            {t.terminal.pills.map((pill) => (
              <span
                key={pill}
                className="px-3.5 py-1.5 rounded-full border border-neutral-200 bg-neutral-50 text-neutral-800 font-mono text-xs tracking-wide font-bold shadow-2xs"
              >
                {pill}
              </span>
            ))}
          </div>
        </motion.div>

        {/* Right Column: Interactive Terminal Mockup */}
        <motion.div
          initial={reduced ? false : { opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-50px' }}
          transition={{ duration: 0.55, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
          className="relative group w-full"
        >
          <div className="relative bg-white border border-neutral-200 rounded-2xl shadow-[0_2px_10px_rgba(0,0,0,0.04)] hover:shadow-[0_16px_40px_-18px_rgba(9,9,11,0.2)] hover:border-neutral-300 transition-all duration-300 overflow-hidden">
            {/* Terminal Header - Tabs */}
            <div className="bg-neutral-100/80 border-b border-neutral-200/80 px-4 pt-3 flex items-center justify-between">
              <div className="flex space-x-1 overflow-x-auto no-scrollbar">
                {(Object.keys(TERMINAL_SNIPPETS) as TabKey[]).map((key) => (
                  <button
                    key={key}
                    onClick={() => handleTabChange(key)}
                    className={`px-3.5 py-2 text-[11px] font-mono font-bold rounded-t-lg transition-all whitespace-nowrap cursor-pointer ${
                      activeTab === key
                        ? 'bg-neutral-900 text-white shadow-sm'
                        : 'text-neutral-500 hover:text-neutral-800'
                    }`}
                  >
                    {TERMINAL_SNIPPETS[key].label}
                  </button>
                ))}
              </div>

              {/* Terminal Traffic Light Controls */}
              <div className="hidden sm:flex items-center space-x-1.5 pb-2 pl-3 shrink-0">
                <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f56] border border-[#e0443e]/50 shadow-2xs" />
                <div className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e] border border-[#dea123]/50 shadow-2xs" />
                <div className="w-2.5 h-2.5 rounded-full bg-[#27c93f] border border-[#1aab29]/50 shadow-2xs" />
              </div>
            </div>

            {/* File Name Title Bar */}
            <div className="bg-white border-b border-neutral-200/80 px-4 py-2 flex items-center justify-between">
              <div className="flex items-center gap-2 text-neutral-600">
                <TerminalIcon className="h-3.5 w-3.5 text-neutral-500" />
                <span className="text-[11px] font-mono font-medium">{snippet.file}</span>
              </div>

              <button
                onClick={handleCopy}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-bold border transition-all cursor-pointer ${
                  copied
                    ? 'border-emerald-500 bg-emerald-500 text-white'
                    : 'border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'
                }`}
              >
                {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                <span>{copied ? t.terminal.copied : t.terminal.copy}</span>
              </button>
            </div>

            {/* Terminal Body - Light Surface */}
            <div ref={bodyRef} className="bg-neutral-50 p-4 sm:p-5">
              {/* Typing command; untyped rest is laid out invisibly so the box never grows while typing */}
              <div className="font-mono text-xs sm:text-[13px] leading-relaxed mb-4 min-h-[100px] whitespace-pre-wrap break-words">
                <span className="text-emerald-600 select-none">$ </span>
                <span className="text-neutral-800 font-semibold">{command.slice(0, typedCount)}</span>
                <span
                  className={`inline-block w-[7px] h-[15px] bg-neutral-800/80 align-middle ml-0.5 ${typing ? '' : 'animate-pulse'}`}
                  aria-hidden="true"
                />
                <span className="text-transparent select-none" aria-hidden="true">{command.slice(typedCount)}</span>
              </div>

              {/* Animated Output Lines */}
              <div className="space-y-1.5 min-h-[100px]">
                {outputLines.map((line, idx) => (
                  <div
                    key={idx}
                    className={`flex items-start gap-2 transition-[opacity,transform] duration-300 ease-out ${
                      idx < visibleLines ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1'
                    }`}
                  >
                    <span className="text-neutral-300 text-[11px] select-none shrink-0">{idx + 1}</span>
                    <span
                      className={
                        line.startsWith('✔')
                          ? 'text-emerald-600'
                          : line.startsWith('<<<')
                            ? 'text-neutral-800 font-semibold'
                            : line.startsWith('>>>')
                              ? 'text-neutral-400'
                              : 'text-neutral-600'
                      }
                    >
                      {line}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
