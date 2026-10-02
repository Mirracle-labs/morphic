'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Terminal,
  Copy,
  Check,
  Code2,
  Cpu,
  Layers,
  ShieldCheck,
  AlertCircle,
  ArrowRight,
  Server,
  KeyRound,
  FileCode,
  ChevronRight,
  CheckCircle2,
  HelpCircle,
  ExternalLink,
  Menu,
  X,
} from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { API_BASE_URL, CHAT_COMPLETIONS_URL } from '@/lib/utils';

const BASE_URL = API_BASE_URL;
const CHAT_URL = CHAT_COMPLETIONS_URL;

type IdeKey = 'cursor' | 'cline' | 'windsurf' | 'claudecode' | 'opencode' | 'aider';
type SdkKey = 'ts' | 'python' | 'curl';
type OsKey = 'windows' | 'macos' | 'linux';
type WindowsShell = 'powershell' | 'cmd';

function WindowsIcon({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M0 3.449L9.75 2.1v9.451H0m10.949-9.602L24 0v11.4H10.949M0 12.6h9.75v9.451L0 20.699M10.949 12.6H24V24l-12.949-1.801" />
    </svg>
  );
}

function AppleIcon({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 6.37c.61-.75 1.04-1.8 1.01-2.87-.96.04-2.15.65-2.81 1.43-.58.68-.99 1.74-.95 2.81 1.08.08 2.14-.61 2.75-1.37z" />
    </svg>
  );
}

function LinuxIcon({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12.003 2c-2.228 0-4.033 1.792-4.033 4.004 0 .548.11 1.07.31 1.55C6.012 8.448 4.5 10.536 4.5 13.003c0 2.222 1.22 4.159 3.026 5.18-.017.26-.026.525-.026.793 0 1.67.667 3.024 3.002 3.024h3.001c2.335 0 3.002-1.354 3.002-3.024 0-.268-.009-.533-.026-.793 1.806-1.021 3.026-2.958 3.026-5.18 0-2.467-1.512-4.555-3.78-5.449.2-.48.31-1.002.31-1.55C16.036 3.792 14.231 2 12.003 2zm-1.501 4.502a.75.75 0 110-1.5.75.75 0 010 1.5zm3.002 0a.75.75 0 110-1.5.75.75 0 010 1.5z" />
    </svg>
  );
}

function OsSelector({
  selectedOs,
  onSelectOs,
  selectedWinShell,
  onSelectWinShell,
  isId,
  className = '',
}: {
  selectedOs: OsKey;
  onSelectOs: (os: OsKey) => void;
  selectedWinShell: WindowsShell;
  onSelectWinShell: (shell: WindowsShell) => void;
  isId: boolean;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      <div className="inline-flex items-center gap-1 p-1 bg-neutral-100 rounded-xl border border-neutral-200/80 text-xs">
        <button
          type="button"
          onClick={() => onSelectOs('windows')}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
            selectedOs === 'windows'
              ? 'bg-white text-neutral-950 shadow-2xs font-bold'
              : 'text-neutral-600 hover:text-neutral-950 hover:bg-neutral-200/50'
          }`}
        >
          <WindowsIcon className="w-3.5 h-3.5" />
          <span>Windows</span>
        </button>

        <button
          type="button"
          onClick={() => onSelectOs('macos')}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
            selectedOs === 'macos'
              ? 'bg-white text-neutral-950 shadow-2xs font-bold'
              : 'text-neutral-600 hover:text-neutral-950 hover:bg-neutral-200/50'
          }`}
        >
          <AppleIcon className="w-3.5 h-3.5" />
          <span>macOS</span>
        </button>

        <button
          type="button"
          onClick={() => onSelectOs('linux')}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
            selectedOs === 'linux'
              ? 'bg-white text-neutral-950 shadow-2xs font-bold'
              : 'text-neutral-600 hover:text-neutral-950 hover:bg-neutral-200/50'
          }`}
        >
          <LinuxIcon className="w-3.5 h-3.5" />
          <span>Linux</span>
        </button>
      </div>

      {selectedOs === 'windows' && (
        <div className="inline-flex items-center gap-1 p-1 bg-neutral-100/90 rounded-xl border border-neutral-200/80 text-xs">
          <button
            type="button"
            onClick={() => onSelectWinShell('powershell')}
            className={`px-2 py-0.5 rounded-md text-[11px] font-mono transition cursor-pointer ${
              selectedWinShell === 'powershell'
                ? 'bg-neutral-900 text-white font-bold shadow-2xs'
                : 'text-neutral-600 hover:text-neutral-950 hover:bg-neutral-200/40 font-medium'
            }`}
          >
            PowerShell
          </button>
          <button
            type="button"
            onClick={() => onSelectWinShell('cmd')}
            className={`px-2 py-0.5 rounded-md text-[11px] font-mono transition cursor-pointer ${
              selectedWinShell === 'cmd'
                ? 'bg-neutral-900 text-white font-bold shadow-2xs'
                : 'text-neutral-600 hover:text-neutral-950 hover:bg-neutral-200/40 font-medium'
            }`}
          >
            CMD
          </button>
        </div>
      )}
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label?: string }) {
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
      aria-label={label || 'Copy'}
      className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-700/80 bg-neutral-800 px-2 py-1 text-[11px] font-semibold text-neutral-300 transition-colors hover:bg-neutral-700 hover:text-white cursor-pointer shrink-0"
    >
      {copied ? (
        <Check className="h-3 w-3 text-emerald-400" />
      ) : (
        <Copy className="h-3 w-3" />
      )}
      <span>{copied ? 'Tersalin' : 'Salin'}</span>
    </button>
  );
}

function CodeBlock({
  code,
  filename,
  language,
}: {
  code: string;
  filename?: string;
  language?: string;
}) {
  return (
    <div className="rounded-xl bg-neutral-950 border border-neutral-800/90 overflow-hidden text-neutral-200 shadow-2xs my-3">
      <div className="flex items-center justify-between px-3.5 py-2 border-b border-neutral-800/80 bg-neutral-900/60">
        <div className="flex items-center gap-2">
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-[#ff5f56] border border-[#e0443e]/50" />
            <div className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e] border border-[#dea123]/50" />
            <div className="w-2.5 h-2.5 rounded-full bg-[#27c93f] border border-[#1aab29]/50" />
          </div>
          {filename && (
            <span className="font-mono text-[11px] text-neutral-500 font-medium ml-2">
              {filename}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2.5">
          {language && (
            <span className="text-[10px] font-mono uppercase tracking-wider text-neutral-500 font-semibold">
              {language}
            </span>
          )}
          <CopyButton text={code} />
        </div>
      </div>
      <div className="p-3.5 sm:p-4 overflow-x-auto">
        <pre className="font-mono text-xs leading-relaxed text-neutral-200 selection:bg-neutral-800">
          <code>{code}</code>
        </pre>
      </div>
    </div>
  );
}

interface DocsViewProps {
  session?: any;
}

export default function DocsView({ session }: DocsViewProps) {
  const { locale } = useTranslation();
  const isId = locale === 'id';

  const [activeIde, setActiveIde] = useState<IdeKey>('cursor');
  const [activeSdk, setActiveSdk] = useState<SdkKey>('ts');
  const [selectedOs, setSelectedOs] = useState<OsKey>('windows');
  const [selectedWinShell, setSelectedWinShell] = useState<WindowsShell>('powershell');
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [copiedBaseUrl, setCopiedBaseUrl] = useState(false);
  const [activeSection, setActiveSection] = useState('overview');

  useEffect(() => {
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent.toLowerCase() : '';
    const detected: OsKey | null = ua.includes('win')
      ? 'windows'
      : ua.includes('mac')
        ? 'macos'
        : ua.includes('linux') || ua.includes('x11')
          ? 'linux'
          : null;
    // The OS tab is seeded from the user agent, which does not exist until after mount, so
    // this one-shot sync has no render-time equivalent.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (detected) setSelectedOs(detected);
  }, []);

  useEffect(() => {
    if (!mobileSidebarOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileSidebarOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mobileSidebarOpen]);

  useEffect(() => {
    const mainSectionIds = [
      'overview',
      'quickstart',
      'base-url',
      'ide-setup',
      'sdk-integration',
      'endpoint-chat',
      'endpoint-models',
      'model-ids',
      'error-codes',
      'security',
    ];

    const handleScroll = () => {
      // Dynamic reading threshold: comfortable eye-level reading zone
      const readingLine = Math.min(280, window.innerHeight * 0.4);

      // Check if near bottom of document
      const isNearBottom =
        window.innerHeight + window.scrollY >=
        document.documentElement.scrollHeight - 300;

      if (isNearBottom) {
        // Prioritize bottom sections when they are visible in viewport
        const secEl = document.getElementById('security');
        if (secEl) {
          const secRect = secEl.getBoundingClientRect();
          if (secRect.top <= window.innerHeight * 0.75) {
            setActiveSection('security');
            return;
          }
        }

        const errEl = document.getElementById('error-codes');
        if (errEl) {
          const errRect = errEl.getBoundingClientRect();
          if (errRect.top <= window.innerHeight * 0.75) {
            setActiveSection('error-codes');
            return;
          }
        }
      }

      let currentSection = mainSectionIds[0];
      for (const id of mainSectionIds) {
        const el = document.getElementById(id);
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.top <= readingLine) {
            currentSection = id;
          }
        }
      }
      setActiveSection(currentSection);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();

    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const copyBaseUrl = () => {
    navigator.clipboard.writeText(BASE_URL);
    setCopiedBaseUrl(true);
    setTimeout(() => setCopiedBaseUrl(false), 2000);
  };

  const getClaudeCodeSnippet = (os: OsKey, winShell: WindowsShell) => {
    if (os === 'macos') {
      return {
        file: 'claude_macos.sh',
        language: 'bash',
        menuPath: 'macOS Terminal (zsh / bash)',
        code: `export ANTHROPIC_BASE_URL="${BASE_URL}"
export ANTHROPIC_API_KEY="mp-live-xxxxxxxxxxxxxxxxxxxx"

claude "Analyze this repository architecture"`,
      };
    }
    if (os === 'linux') {
      return {
        file: 'claude_linux.sh',
        language: 'bash',
        menuPath: 'Linux Terminal (bash)',
        code: `export ANTHROPIC_BASE_URL="${BASE_URL}"
export ANTHROPIC_API_KEY="mp-live-xxxxxxxxxxxxxxxxxxxx"

claude "Analyze this repository architecture"`,
      };
    }
    if (winShell === 'cmd') {
      return {
        file: 'claude_cmd.cmd',
        language: 'cmd',
        menuPath: 'Windows Command Prompt (CMD)',
        code: `set ANTHROPIC_BASE_URL=${BASE_URL}
set ANTHROPIC_API_KEY=mp-live-xxxxxxxxxxxxxxxxxxxx

claude "Analyze this repository architecture"`,
      };
    }
    return {
      file: 'claude_powershell.ps1',
      language: 'powershell',
      menuPath: 'Windows PowerShell Terminal',
      code: `$env:ANTHROPIC_BASE_URL="${BASE_URL}"
$env:ANTHROPIC_API_KEY="mp-live-xxxxxxxxxxxxxxxxxxxx"

claude "Analyze this repository architecture"`,
    };
  };

  // opencode takes its provider from a JSON file, so the first block is that file verbatim
  // (paste it, nothing to edit but the key) and the second is the one command that exports
  // the key it refers to. Schema: https://opencode.ai/docs/config
  const getOpencodeSnippet = (os: OsKey, winShell: WindowsShell) => {
    const config = `{
  "$schema": "https://opencode.ai/config.json",

  "provider": {
    "morphic": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Morphic AI",
      "options": {
        "baseURL": "${BASE_URL}",
        "apiKey": "{env:MORPHIC_API_KEY}"
      },
      "models": {
        "MiniMaxAI/MiniMax-M2.7": {
          "name": "MiniMax M2.7"
        }
      }
    }
  },

  "plugin": []
}`;

    if (os === 'windows' && winShell === 'cmd') {
      return {
        file: 'opencode.json',
        language: 'json',
        menuPath: '%USERPROFILE%\\.config\\opencode\\opencode.json',
        code: config,
        extraFile: 'Command Prompt',
        extraLanguage: 'cmd',
        extraCode: 'setx MORPHIC_API_KEY "API_KEY_MORPHIC_LU"',
      };
    }

    if (os === 'windows') {
      return {
        file: 'opencode.json',
        language: 'json',
        menuPath: '%USERPROFILE%\\.config\\opencode\\opencode.json',
        code: config,
        extraFile: 'PowerShell',
        extraLanguage: 'powershell',
        extraCode: '$env:MORPHIC_API_KEY="API_KEY_MORPHIC_LU"',
      };
    }

    return {
      file: 'opencode.json',
      language: 'json',
      menuPath: '~/.config/opencode/opencode.json',
      code: config,
      extraFile: os === 'macos' ? 'Terminal (zsh)' : 'Terminal (bash)',
      extraLanguage: 'bash',
      extraCode: 'export MORPHIC_API_KEY="API_KEY_MORPHIC_LU"',
    };
  };

  const getAiderSnippet = (os: OsKey, winShell: WindowsShell) => {
    if (os === 'macos') {
      return {
        file: 'run-aider-mac.sh',
        language: 'bash',
        menuPath: 'macOS Terminal (zsh)',
        code: `export OPENAI_API_BASE="${BASE_URL}"
export OPENAI_API_KEY="mp-live-xxxxxxxxxxxxxxxxxxxx"

aider --model openai/deepseek-v4`,
      };
    }
    if (os === 'linux') {
      return {
        file: 'run-aider-linux.sh',
        language: 'bash',
        menuPath: 'Linux Terminal (bash)',
        code: `export OPENAI_API_BASE="${BASE_URL}"
export OPENAI_API_KEY="mp-live-xxxxxxxxxxxxxxxxxxxx"

aider --model openai/deepseek-v4`,
      };
    }
    if (winShell === 'cmd') {
      return {
        file: 'run-aider.cmd',
        language: 'cmd',
        menuPath: 'Windows Command Prompt (CMD)',
        code: `set OPENAI_API_BASE=${BASE_URL}
set OPENAI_API_KEY=mp-live-xxxxxxxxxxxxxxxxxxxx

aider --model openai/deepseek-v4`,
      };
    }
    return {
      file: 'run-aider.ps1',
      language: 'powershell',
      menuPath: 'Windows PowerShell Terminal',
      code: `$env:OPENAI_API_BASE="${BASE_URL}"
$env:OPENAI_API_KEY="mp-live-xxxxxxxxxxxxxxxxxxxx"

aider --model openai/deepseek-v4`,
    };
  };

  const claudeSnippet = getClaudeCodeSnippet(selectedOs, selectedWinShell);
  const opencodeSnippet = getOpencodeSnippet(selectedOs, selectedWinShell);
  const aiderSnippet = getAiderSnippet(selectedOs, selectedWinShell);

  const ideConfigs: Record<
    IdeKey,
    {
      name: string;
      title: string;
      desc: string;
      descEn: string;
      menuPath: string;
      file: string;
      language?: string;
      code: string;
      // A second block for setups that need a file AND a command (opencode).
      extraCode?: string;
      extraFile?: string;
      extraLanguage?: string;
    }
  > = {
    cursor: {
      name: 'Cursor',
      title: 'Cursor IDE (Composer & Inline)',
      desc: 'Gunakan seluruh model AI langsung di Cursor Composer & Inline Edit melalui protokol resmi OpenAI API.',
      descEn: 'Use all AI models directly in Cursor Composer & Inline Edit via the official OpenAI API protocol.',
      menuPath:
        selectedOs === 'macos'
          ? 'Settings (Cmd+Shift+J) > Models > OpenAI API'
          : 'Settings (Ctrl+Shift+J) > Models > OpenAI API',
      file: 'cursor.settings.json',
      language: 'json',
      code: `// Cursor Settings > Models > OpenAI API:
Base URL: ${BASE_URL}
API Key:  mp-live-xxxxxxxxxxxxxxxxxxxx

// Rekomendasi Model IDs untuk ditambahkan (+ Add Model):
- deepseek-v4    (Coding & reasoning, konteks 64K)
- kimi-coding    (Konteks 256K, refactoring multi-file)
- qwen-max       (General purpose & reasoning, konteks 32K)`,
    },
    cline: {
      name: 'Cline / Roo',
      title: 'Cline & Roo Code (VS Code Extension)',
      desc: 'Konfigurasi ekstensi autonomous coding agent di VS Code dengan Morphic Gateway.',
      descEn: 'Configure autonomous coding agents in VS Code with Morphic Gateway.',
      menuPath:
        selectedOs === 'macos'
          ? 'Cline (Cmd+Shift+P) > Settings > API Provider: OpenAI Compatible'
          : 'Cline (Ctrl+Shift+P) > Settings > API Provider: OpenAI Compatible',
      file: 'cline_settings.json',
      language: 'json',
      code: `{
  "apiProvider": "openai",
  "openAiBaseUrl": "${BASE_URL}",
  "openAiApiKey": "mp-live-xxxxxxxxxxxxxxxxxxxx",
  "openAiModelId": "deepseek-v4"
}`,
    },
    windsurf: {
      name: 'Windsurf',
      title: 'Windsurf (Codeium Cascade)',
      desc: 'Jalankan fitur Cascade AI pada Windsurf dengan menghubungkan custom model provider OpenAI.',
      descEn: 'Run Cascade AI features in Windsurf by connecting a custom OpenAI provider.',
      menuPath: 'Windsurf Settings > AI Providers > Custom OpenAI-Compatible Provider',
      file: 'windsurf_config.json',
      language: 'json',
      code: `{
  "provider": "openai-compatible",
  "endpoint": "${BASE_URL}",
  "apiKey": "mp-live-xxxxxxxxxxxxxxxxxxxx",
  "defaultModel": "deepseek-v4"
}`,
    },
    claudecode: {
      name: 'Claude Code CLI',
      title: 'Claude Code CLI (Terminal)',
      desc: 'Jalankan CLI Claude Code resmi di terminal dengan mengarahkan basis endpoint proxy ke Morphic.',
      descEn: 'Run the official Claude Code CLI in your terminal by routing base endpoints to Morphic.',
      menuPath: claudeSnippet.menuPath,
      file: claudeSnippet.file,
      language: claudeSnippet.language,
      code: claudeSnippet.code,
    },
    opencode: {
      name: 'opencode',
      title: 'opencode (Terminal AI Agent)',
      desc: 'Tulis config opencode sekali paste di terminal, lalu agent langsung terhubung ke Morphic Gateway.',
      descEn: 'Paste one terminal block to write the opencode config, and the agent connects to Morphic Gateway straight away.',
      menuPath: opencodeSnippet.menuPath,
      file: opencodeSnippet.file,
      language: opencodeSnippet.language,
      code: opencodeSnippet.code,
      extraCode: opencodeSnippet.extraCode,
      extraFile: opencodeSnippet.extraFile,
      extraLanguage: opencodeSnippet.extraLanguage,
    },
    aider: {
      name: 'Aider',
      title: 'Aider (Command-line Pair Programming)',
      desc: 'Pair programming di command line dengan Aider menggunakan satu baris perintah.',
      descEn: 'Pair program in the command line with Aider using a single terminal command.',
      menuPath: aiderSnippet.menuPath,
      file: aiderSnippet.file,
      language: aiderSnippet.language,
      code: aiderSnippet.code,
    },
  };

  const getQuickstartSnippet = (os: OsKey, winShell: WindowsShell) => {
    if (os === 'macos') {
      return {
        filename: 'curl_quickstart.sh',
        language: 'bash',
        code: `curl ${CHAT_URL} \\
  -H "Authorization: Bearer mp-live-xxxxxxxxxxxxxxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "deepseek-v4",
    "messages": [
      { "role": "system", "content": "You are an expert developer." },
      { "role": "user", "content": "Hello Morphic Gateway!" }
    ],
    "temperature": 0.2
  }'`,
      };
    }
    if (os === 'linux') {
      return {
        filename: 'curl_quickstart.sh',
        language: 'bash',
        code: `curl ${CHAT_URL} \\
  -H "Authorization: Bearer mp-live-xxxxxxxxxxxxxxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "deepseek-v4",
    "messages": [
      { "role": "system", "content": "You are an expert developer." },
      { "role": "user", "content": "Hello Morphic Gateway!" }
    ],
    "temperature": 0.2
  }'`,
      };
    }
    if (winShell === 'cmd') {
      return {
        filename: 'quickstart.cmd',
        language: 'cmd',
        code: `curl.exe ${CHAT_URL} ^
  -H "Authorization: Bearer mp-live-xxxxxxxxxxxxxxxxxxxx" ^
  -H "Content-Type: application/json" ^
  -d "{\\"model\\":\\"deepseek-v4\\",\\"messages\\":[{\\"role\\":\\"system\\",\\"content\\":\\"You are an expert developer.\\"},{\\"role\\":\\"user\\",\\"content\\":\\"Hello Morphic Gateway!\\"}],\\"temperature\\":0.2}"`,
      };
    }
    return {
      filename: 'quickstart.ps1',
      language: 'powershell',
      code: `# Opsi 1: Menggunakan curl.exe bawaan Windows (PowerShell)
curl.exe ${CHAT_URL} \`
  -H "Authorization: Bearer mp-live-xxxxxxxxxxxxxxxxxxxx" \`
  -H "Content-Type: application/json" \`
  -d '{"model":"deepseek-v4","messages":[{"role":"system","content":"You are an expert developer."},{"role":"user","content":"Hello Morphic Gateway!"}],"temperature":0.2}'

# Opsi 2: Menggunakan cmdlet native PowerShell (Invoke-RestMethod)
$headers = @{
  "Authorization" = "Bearer mp-live-xxxxxxxxxxxxxxxxxxxx"
  "Content-Type"  = "application/json"
}
$body = @{
  model = "deepseek-v4"
  messages = @(
    @{ role = "system"; content = "You are an expert developer." }
    @{ role = "user"; content = "Hello Morphic Gateway!" }
  )
  temperature = 0.2
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Uri "${CHAT_URL}" -Method Post -Headers $headers -Body $body`,
    };
  };

  const getCurlSdkSnippet = (os: OsKey, winShell: WindowsShell) => {
    if (os === 'macos' || os === 'linux') {
      return {
        filename: 'curl_example.sh',
        language: 'bash',
        code: `# 1. Chat Completion Standar (JSON):
curl ${CHAT_URL} \\
  -H "Authorization: Bearer mp-live-xxxxxxxxxxxxxxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "deepseek-v4",
    "messages": [
      { "role": "user", "content": "Halo Morphic! Buatkan fungsi validasi email." }
    ],
    "temperature": 0.5,
    "max_tokens": 512
  }'

# 2. Server-Sent Events (SSE Streaming):
curl ${CHAT_URL} \\
  -N \\
  -H "Authorization: Bearer mp-live-xxxxxxxxxxxxxxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "deepseek-v4",
    "messages": [{ "role": "user", "content": "Hitung 1 sampai 5 perlahan." }],
    "stream": true
  }'`,
      };
    }
    if (winShell === 'cmd') {
      return {
        filename: 'curl_example.cmd',
        language: 'cmd',
        code: `REM 1. Chat Completion Standar (curl.exe di Command Prompt):
curl.exe ${CHAT_URL} ^
  -H "Authorization: Bearer mp-live-xxxxxxxxxxxxxxxxxxxx" ^
  -H "Content-Type: application/json" ^
  -d "{\\"model\\":\\"deepseek-v4\\",\\"messages\\":[{\\"role\\":\\"user\\",\\"content\\":\\"Halo Morphic! Buatkan fungsi validasi email.\\"}],\\"temperature\\":0.5,\\"max_tokens\\":512}"

REM 2. Server-Sent Events (SSE Streaming via curl.exe):
curl.exe ${CHAT_URL} -N ^
  -H "Authorization: Bearer mp-live-xxxxxxxxxxxxxxxxxxxx" ^
  -H "Content-Type: application/json" ^
  -d "{\\"model\\":\\"deepseek-v4\\",\\"messages\\":[{\\"role\\":\\"user\\",\\"content\\":\\"Hitung 1 sampai 5 perlahan.\\"}],\\"stream\\":true}"`,
      };
    }
    return {
      filename: 'curl_example.ps1',
      language: 'powershell',
      code: `# 1. Chat Completion Standar (curl.exe bawaan Windows PowerShell):
curl.exe ${CHAT_URL} \`
  -H "Authorization: Bearer mp-live-xxxxxxxxxxxxxxxxxxxx" \`
  -H "Content-Type: application/json" \`
  -d '{"model":"deepseek-v4","messages":[{"role":"user","content":"Halo Morphic! Buatkan fungsi validasi email."}],"temperature":0.5,"max_tokens":512}'

# 2. Server-Sent Events (SSE Streaming via curl.exe):
curl.exe ${CHAT_URL} -N \`
  -H "Authorization: Bearer mp-live-xxxxxxxxxxxxxxxxxxxx" \`
  -H "Content-Type: application/json" \`
  -d '{"model":"deepseek-v4","messages":[{"role":"user","content":"Hitung 1 sampai 5 perlahan."}],"stream":true}'`,
    };
  };

  const quickstartSnippet = getQuickstartSnippet(selectedOs, selectedWinShell);
  const curlSdkSnippet = getCurlSdkSnippet(selectedOs, selectedWinShell);

  const tsCode = `import OpenAI from "openai";

// Inisialisasi client resmi OpenAI mengarah ke Morphic Gateway
const client = new OpenAI({
  baseURL: "${BASE_URL}",
  apiKey: process.env.MORPHIC_API_KEY || "mp-live-xxxxxxxxxxxxxxxxxxxx",
});

async function main() {
  // 1. Chat Completion Standar
  const completion = await client.chat.completions.create({
    model: "deepseek-v4",
    messages: [
      { role: "system", content: "You are an expert TypeScript engineer." },
      { role: "user", content: "Buatkan helper debounce typed di TypeScript." },
    ],
    temperature: 0.2,
  });

  console.log(completion.choices[0].message.content);

  // 2. Real-time Streaming (SSE)
  const stream = await client.chat.completions.create({
    model: "deepseek-v4",
    messages: [{ role: "user", content: "Jelaskan arsitektur micro-frontend." }],
    stream: true,
  });

  for await (const chunk of stream) {
    process.stdout.write(chunk.choices[0]?.delta?.content || "");
  }
}

main().catch(console.error);`;

  const pythonCode = `import os
from openai import OpenAI

# Inisialisasi OpenAI SDK resmi dengan endpoint Morphic Gateway
client = OpenAI(
    base_url="${BASE_URL}",
    api_key=os.environ.get("MORPHIC_API_KEY", "mp-live-xxxxxxxxxxxxxxxxxxxx"),
)

# 1. Non-streaming completion
response = client.chat.completions.create(
    model="deepseek-v4",
    messages=[
        {"role": "system", "content": "You are a backend architect."},
        {"role": "user", "content": "Tuliskan implementasi caching Redis di Python."},
    ],
    temperature=0.3,
)

print(response.choices[0].message.content)

# 2. Real-time Streaming (SSE)
stream = client.chat.completions.create(
    model="kimi-coding",
    messages=[{"role": "user", "content": "Optimasi query PostgreSQL berikut..."}],
    stream=True,
)

for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)
`;

  const curlCode = `# 1. Chat Completion Standar (JSON):
curl ${CHAT_URL} \\
  -H "Authorization: Bearer mp-live-xxxxxxxxxxxxxxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "deepseek-v4",
    "messages": [
      { "role": "user", "content": "Halo Morphic! Buatkan fungsi validasi email." }
    ],
    "temperature": 0.5,
    "max_tokens": 512
  }'

# 2. Server-Sent Events (SSE Streaming):
curl ${CHAT_URL} \\
  -N \\
  -H "Authorization: Bearer mp-live-xxxxxxxxxxxxxxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "deepseek-v4",
    "messages": [{ "role": "user", "content": "Hitung 1 sampai 5 perlahan." }],
    "stream": true
  }'`;

  interface SidebarSubItem {
    id: string;
    label: string;
    href: string;
    key?: string;
    onClick?: () => void;
  }

  interface SidebarItem {
    id: string;
    sectionId?: string;
    label: string;
    href: string;
    isMono?: boolean;
    key?: string;
    onClick?: () => void;
  }

  interface SidebarGroup {
    title: string;
    items: SidebarItem[];
  }

  const navGroups: SidebarGroup[] = [
    {
      title: isId ? 'Memulai' : 'Getting Started',
      items: [
        {
          id: 'overview',
          label: isId ? 'Arsitektur Gateway' : 'Gateway Architecture',
          href: '#overview',
        },
        {
          id: 'quickstart',
          label: isId ? 'Mulai Cepat (< 30s)' : 'Quickstart (< 30s)',
          href: '#quickstart',
        },
        {
          id: 'base-url',
          label: isId ? 'Base URL & Kredensial' : 'Base URL & Auth',
          href: '#base-url',
        },
      ],
    },
    {
      title: isId ? 'Integrasi Editor & Agent' : 'IDE & Coding Agents',
      items: [
        {
          id: 'ide-cursor',
          sectionId: 'ide-setup',
          key: 'cursor',
          label: 'Cursor IDE',
          href: '#ide-setup',
          onClick: () => setActiveIde('cursor'),
        },
        {
          id: 'ide-cline',
          sectionId: 'ide-setup',
          key: 'cline',
          label: 'Cline / Roo Code',
          href: '#ide-setup',
          onClick: () => setActiveIde('cline'),
        },
        {
          id: 'ide-windsurf',
          sectionId: 'ide-setup',
          key: 'windsurf',
          label: 'Windsurf Cascade',
          href: '#ide-setup',
          onClick: () => setActiveIde('windsurf'),
        },
        {
          id: 'ide-claudecode',
          sectionId: 'ide-setup',
          key: 'claudecode',
          label: 'Claude Code CLI',
          href: '#ide-setup',
          onClick: () => setActiveIde('claudecode'),
        },
        {
          id: 'ide-opencode',
          sectionId: 'ide-setup',
          key: 'opencode',
          label: 'opencode',
          href: '#ide-setup',
          onClick: () => setActiveIde('opencode'),
        },
        {
          id: 'ide-aider',
          sectionId: 'ide-setup',
          key: 'aider',
          label: 'Aider CLI',
          href: '#ide-setup',
          onClick: () => setActiveIde('aider'),
        },
      ],
    },
    {
      title: isId ? 'SDK & Kode Bahasa' : 'Libraries & SDKs',
      items: [
        {
          id: 'sdk-ts',
          sectionId: 'sdk-integration',
          key: 'ts',
          label: 'TypeScript / Node.js',
          href: '#sdk-integration',
          onClick: () => setActiveSdk('ts'),
        },
        {
          id: 'sdk-python',
          sectionId: 'sdk-integration',
          key: 'python',
          label: 'Python (openai)',
          href: '#sdk-integration',
          onClick: () => setActiveSdk('python'),
        },
        {
          id: 'sdk-curl',
          sectionId: 'sdk-integration',
          key: 'curl',
          label: 'cURL / Raw HTTP',
          href: '#sdk-integration',
          onClick: () => setActiveSdk('curl'),
        },
      ],
    },
    {
      title: isId ? 'Referensi API' : 'API Reference',
      items: [
        {
          id: 'endpoint-chat',
          label: 'POST /v1/chat/completions',
          href: '#endpoint-chat',
          isMono: true,
        },
        {
          id: 'endpoint-models',
          label: 'GET /v1/models',
          href: '#endpoint-models',
          isMono: true,
        },
        {
          id: 'model-ids',
          label: isId ? 'Katalog Model ID' : 'Model IDs Catalog',
          href: '#model-ids',
        },
      ],
    },
    {
      title: isId ? 'Keandalan & Error' : 'Reliability & Errors',
      items: [
        {
          id: 'error-codes',
          label: isId ? 'Daftar Kode Error' : 'HTTP Error Codes',
          href: '#error-codes',
        },
        {
          id: 'security',
          label: isId ? 'Praktik Keamanan' : 'Security Best Practices',
          href: '#security',
        },
      ],
    },
  ];

  const sidebarNav = (
    <nav className="space-y-6 text-xs select-none">
      {navGroups.map((group) => (
        <div key={group.title} className="space-y-1.5">
          <div className="font-mono text-[10px] font-bold uppercase tracking-wider text-neutral-500 px-3">
            {group.title}
          </div>

          <div className="space-y-0.5">
            {group.items.map((item) => {
              const isActive =
                item.sectionId === 'ide-setup'
                  ? activeSection === 'ide-setup' && activeIde === item.key
                  : item.sectionId === 'sdk-integration'
                  ? activeSection === 'sdk-integration' && activeSdk === item.key
                  : activeSection === item.id;

              return (
                <div key={item.id} className="relative">
                  <a
                    href={item.href}
                    onClick={() => {
                      if (item.onClick) item.onClick();
                      setMobileSidebarOpen(false);
                    }}
                    className={`relative flex items-center justify-between px-3 py-1.5 rounded-lg transition-colors ${
                      item.isMono ? 'font-mono text-[11px]' : 'text-xs'
                    } ${
                      isActive
                        ? 'font-bold text-neutral-950'
                        : 'text-neutral-500 hover:text-neutral-900 hover:bg-neutral-50 font-medium'
                    }`}
                  >
                    {isActive && (
                      <motion.div
                        layoutId="sidebarActiveHighlight"
                        className="absolute inset-0 bg-neutral-100 rounded-lg -z-10 shadow-2xs border border-neutral-200/80"
                        transition={{ type: 'spring', stiffness: 400, damping: 35 }}
                      />
                    )}
                    <span className="truncate">{item.label}</span>
                  </a>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="w-full bg-white text-neutral-900 pt-28 sm:pt-32 pb-24">
      {/* Main 2-Column Documentation Canvas */}
      <div className="max-w-7xl mx-auto w-full px-4 sm:px-6 lg:px-8 flex items-start">
        <aside className="hidden lg:block w-64 xl:w-72 shrink-0 sticky top-28 sm:top-32 self-start max-h-[calc(100vh-8.5rem)] overflow-y-auto py-2 pr-6 border-r border-neutral-200/80 [scrollbar-width:thin]">
          {sidebarNav}
        </aside>

        {/* Mobile Floating Drawer Button */}
        <button
          type="button"
          onClick={() => setMobileSidebarOpen(true)}
          className="lg:hidden fixed bottom-6 left-6 z-40 px-3.5 py-2.5 rounded-full bg-neutral-950 text-white shadow-2xl cursor-pointer hover:bg-neutral-800 transition flex items-center gap-2 text-xs font-bold"
          aria-label="Open Documentation Table of Contents"
        >
          <Menu className="h-4 w-4" />
          <span>{isId ? 'Daftar Isi Dokumen' : 'Documentation Menu'}</span>
        </button>

        {/* Mobile Drawer */}
        {mobileSidebarOpen && (
          <div className="lg:hidden fixed inset-0 z-50">
            <div
              className="absolute inset-0 bg-black/40 backdrop-blur-xs"
              onClick={() => setMobileSidebarOpen(false)}
            />
            <div className="absolute top-0 left-0 h-full w-72 bg-white border-r border-neutral-200 p-6 shadow-2xl overflow-y-auto z-10 animate-in slide-in-from-left duration-200">
              <div className="flex items-center justify-between pb-4 mb-4 border-b border-neutral-100">
                <span className="font-heading font-bold text-sm text-neutral-950">
                  {isId ? 'Daftar Isi Dokumen' : 'Documentation'}
                </span>
                <button
                  type="button"
                  onClick={() => setMobileSidebarOpen(false)}
                  className="p-1.5 rounded-lg text-neutral-500 hover:text-neutral-950 hover:bg-neutral-100 transition cursor-pointer"
                  aria-label="Close Documentation Menu"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {sidebarNav}
            </div>
          </div>
        )}

        {/* RIGHT: Clean Editorial Reading Column (Only this area scrolls!) */}
        <div className="flex-1 min-w-0 max-w-4xl py-2 lg:py-2 px-0 lg:px-12 space-y-16">
          {/* Header & Quick Endpoint Callout */}
          <div className="space-y-4 pb-4 border-b border-neutral-100">
            <div className="flex items-center gap-2 text-xs text-neutral-500 font-mono">
              <Link href="/" className="hover:text-neutral-900 transition">Morphic</Link>
              <span>/</span>
              <span className="text-neutral-900 font-semibold">{isId ? 'Dokumentasi Gateway' : 'Gateway Docs'}</span>
            </div>

            <div className="space-y-2">
              <h1 className="text-3xl sm:text-4xl font-heading font-extrabold text-neutral-950 tracking-tight">
                {isId ? 'Dokumentasi & Integrasi Morphic Gateway' : 'Morphic AI Gateway Documentation'}
              </h1>
              <p className="text-sm sm:text-base text-neutral-600 leading-relaxed max-w-3xl">
                {isId
                  ? 'Morphic AI Gateway adalah reverse proxy cerdas berkecepatan tinggi yang kompatibel 100% dengan OpenAI wire protocol. Gunakan satu Base URL dan satu API Key untuk mengakses DeepSeek V4, Claude 3.5 Sonnet, Qwen 2.5, dan model terbaik lainnya tanpa berlangganan kartu kredit internasional terpisah.'
                  : 'Morphic AI Gateway is a high-speed intelligent reverse-proxy 100% compliant with the OpenAI wire protocol. Use a single Base URL and API Key to access DeepSeek V4, Claude 3.5 Sonnet, Qwen 2.5, and more without separate international subscriptions.'}
              </p>
            </div>

            {/* Quick Monospace Base URL Callout in Header */}
            <div className="pt-2">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl bg-neutral-50 border border-neutral-200/90 text-xs">
                <div className="flex items-center gap-2.5 truncate font-mono">
                  <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider shrink-0">
                    CANONICAL BASE URL
                  </span>
                  <span className="text-neutral-950 font-bold select-all truncate">
                    {BASE_URL}
                  </span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={copyBaseUrl}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-neutral-200 hover:bg-neutral-100 text-neutral-800 text-xs font-semibold transition cursor-pointer shadow-2xs"
                  >
                    {copiedBaseUrl ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-600" />
                        <span className="text-emerald-700">{isId ? 'Tersalin' : 'Copied'}</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5 text-neutral-500" />
                        <span>{isId ? 'Salin URL' : 'Copy URL'}</span>
                      </>
                    )}
                  </button>

                  <Link
                    href={session ? '/dashboard/keys' : '/login'}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-neutral-950 hover:bg-neutral-800 text-white text-xs font-bold transition cursor-pointer shadow-2xs"
                  >
                    <KeyRound className="h-3 w-3" />
                    <span>{session ? (isId ? 'Kunci API' : 'API Keys') : (isId ? 'Dapatkan Kunci' : 'Get Key')}</span>
                  </Link>
                </div>
              </div>
            </div>
          </div>

          {/* SECTION 1: ARCHITECTURE */}
          <section id="overview" className="scroll-mt-32 sm:scroll-mt-36 space-y-4">
            <h2 className="text-xl sm:text-2xl font-heading font-bold text-neutral-950 pb-2 border-b border-neutral-100">
              {isId ? 'Arsitektur & Kompatibilitas Wire-Protocol' : 'Gateway Architecture & Wire-Protocol'}
            </h2>

            <p className="text-sm text-neutral-600 leading-relaxed">
              {isId
                ? 'Morphic beroperasi sebagai drop-in reverse proxy resmi untuk ekosistem OpenAI. Seluruh request client dialirkan secara transparan ke provider model upstream (DeepSeek, Anthropic, Qwen, Moonshot Kimi) dengan mempertahankan format wire-protocol OpenAI.'
                : 'Morphic operates as a transparent drop-in reverse proxy for the OpenAI ecosystem. All client requests are streamed directly to upstream providers (DeepSeek, Anthropic, Qwen, Moonshot Kimi) maintaining exact OpenAI wire specifications.'}
            </p>

            <ul className="space-y-2 text-xs sm:text-sm text-neutral-700 pt-1">
              <li id="overview-wire" className="scroll-mt-36 flex items-start gap-2">
                <span className="font-mono text-neutral-500 font-bold">&bull;</span>
                <div>
                  <strong className="text-neutral-950">100% Drop-in Compatibility:</strong> Mendukung rute <code className="font-mono bg-neutral-100 px-1 py-0.5 rounded text-neutral-900">/v1/chat/completions</code> dan <code className="font-mono bg-neutral-100 px-1 py-0.5 rounded text-neutral-900">/v1/models</code> tanpa perubahan kode aplikasi Anda.
                </div>
              </li>
              <li id="overview-sse" className="scroll-mt-36 flex items-start gap-2">
                <span className="font-mono text-neutral-500 font-bold">&bull;</span>
                <div>
                  <strong className="text-neutral-950">Low-Latency SSE Streaming:</strong> Mendukung Server-Sent Events real-time chunking (<code className="font-mono bg-neutral-100 px-1 py-0.5 rounded text-neutral-900">stream: true</code>) yang dioptimasi untuk Cursor Composer, Cline, dan interactive chat.
                </div>
              </li>
              <li id="overview-zdr" className="scroll-mt-36 flex items-start gap-2">
                <span className="font-mono text-neutral-500 font-bold">&bull;</span>
                <div>
                  <strong className="text-neutral-950">Zero Data Retention (ZDR):</strong> Seluruh payload prompt, file context, dan completions dialirkan secara ephemeral tanpa pernah disimpan ke persistent disk atau database kami.
                </div>
              </li>
            </ul>
          </section>

          {/* SECTION 2: QUICKSTART */}
          <section id="quickstart" className="scroll-mt-32 sm:scroll-mt-36 space-y-5">
            <h2 className="text-xl sm:text-2xl font-heading font-bold text-neutral-950 pb-2 border-b border-neutral-100">
              {isId ? 'Mulai Cepat (< 30 Detik)' : 'Quickstart (< 30 Seconds)'}
            </h2>

            <p className="text-sm text-neutral-600 leading-relaxed">
              {isId
                ? 'Jalankan chat completion pertama Anda melalui terminal dalam dua langkah ringkas:'
                : 'Send your first chat completion through Morphic Gateway directly from your terminal in two steps:'}
            </p>

            {/* Step 1 */}
            <div id="qs-key" className="scroll-mt-36 space-y-2">
              <div className="flex items-center gap-2 text-sm font-bold text-neutral-950">
                <span className="w-5 h-5 rounded-full bg-neutral-900 text-white flex items-center justify-center text-xs font-mono">1</span>
                <span>{isId ? 'Dapatkan Kunci API dari Dashboard' : 'Obtain Your API Key'}</span>
              </div>
              <p className="text-xs text-neutral-600 pl-7">
                {isId ? 'Kunci diawali prefix' : 'Keys start with prefix'}{' '}
                <code className="font-mono bg-neutral-100 px-1 py-0.5 rounded text-neutral-900">mp-live-xxxxxxxxxxxxxxxxxxxx</code>.{' '}
                <Link href="/dashboard/keys" className="font-semibold text-neutral-950 hover:underline">
                  {isId ? 'Buka tab API Keys →' : 'Go to API Keys →'}
                </Link>
              </p>
            </div>

            {/* Step 2 */}
            <div id="qs-curl" className="scroll-mt-36 space-y-3 pt-2">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-bold text-neutral-950">
                  <span className="w-5 h-5 rounded-full bg-neutral-900 text-white flex items-center justify-center text-xs font-mono">2</span>
                  <span>{isId ? 'Kirim Permintaan Pertama via Terminal' : 'Execute First Terminal Request'}</span>
                </div>
                <OsSelector
                  selectedOs={selectedOs}
                  onSelectOs={setSelectedOs}
                  selectedWinShell={selectedWinShell}
                  onSelectWinShell={setSelectedWinShell}
                  isId={isId}
                />
              </div>

              <div className="pl-0 sm:pl-7 space-y-3">
                <CodeBlock
                  filename={quickstartSnippet.filename}
                  language={quickstartSnippet.language}
                  code={quickstartSnippet.code}
                />

                {selectedOs === 'windows' && (
                  <div className="p-2.5 rounded-lg bg-neutral-50 border border-neutral-200/80 text-[11px] text-neutral-600 space-y-1">
                    <p className="font-semibold text-neutral-900">
                      {isId ? 'Catatan Pengguna Windows:' : 'Windows Usage Note:'}
                    </p>
                    <p>
                      {selectedWinShell === 'powershell'
                        ? (isId
                            ? 'Pada Windows 10/11, gunakan curl.exe (dengan .exe eksplisit) agar tidak bertabrakan dengan alias PowerShell bawaan, atau jalankan skrip Invoke-RestMethod native di atas.'
                            : 'On Windows 10/11, run curl.exe explicitly to bypass the PowerShell alias, or run the native Invoke-RestMethod script above.')
                        : (isId
                            ? 'Pada Command Prompt (CMD), sambungan baris menggunakan simbol caret (^) dan tanda petik ganda JSON di-escape dengan backslash (\").'
                            : 'In Command Prompt (CMD), multi-line breaks use caret (^) and JSON double-quotes are escaped with backslash (\").')}
                    </p>
                  </div>
                )}

                <div id="qs-response" className="scroll-mt-36 text-[11px] font-semibold text-neutral-500 uppercase tracking-wider pt-1">
                  {isId ? 'Contoh Respon Server (HTTP 200 OK):' : 'Expected Server Response (HTTP 200 OK):'}
                </div>
                <CodeBlock
                  filename="response_200.json"
                  language="json"
                  code={`{
  "id": "chatcmpl-morph-98f2b314d",
  "object": "chat.completion",
  "created": 1741628400,
  "model": "deepseek-v4",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Hello! I am DeepSeek V4 running via Morphic Gateway. How can I help you build today?"
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 18,
    "completion_tokens": 24,
    "total_tokens": 42
  }
}`}
                />
              </div>
            </div>
          </section>

          {/* SECTION 3: BASE URL & AUTH */}
          <section id="base-url" className="scroll-mt-32 sm:scroll-mt-36 space-y-4">
            <h2 className="text-xl sm:text-2xl font-heading font-bold text-neutral-950 pb-2 border-b border-neutral-100">
              {isId ? 'Basis URL & Otentikasi' : 'Base URL & Authentication'}
            </h2>

            <p className="text-sm text-neutral-600 leading-relaxed">
              {isId
                ? 'Semua request API diarahkan ke endpoint kanonikal Morphic dengan otentikasi Bearer Token. Kunci API Anda diautentikasi dengan proteksi Zero Data Retention (ZDR).'
                : 'All API requests route through Morphic’s canonical base endpoint using a Bearer token. Your API key is authenticated cryptographically with Zero Data Retention (ZDR).'}
            </p>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-neutral-50 border border-neutral-200/90 text-xs">
              <div className="flex items-center gap-2.5 truncate font-mono">
                <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider shrink-0">
                  CANONICAL BASE URL
                </span>
                <span className="text-neutral-950 font-bold select-all truncate">
                  {BASE_URL}
                </span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={copyBaseUrl}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white border border-neutral-200 hover:bg-neutral-100 text-neutral-800 text-xs font-semibold transition cursor-pointer shadow-2xs"
                >
                  {copiedBaseUrl ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-600" />
                      <span className="text-emerald-700">{isId ? 'Tersalin' : 'Copied'}</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5 text-neutral-500" />
                      <span>{isId ? 'Salin URL' : 'Copy URL'}</span>
                    </>
                  )}
                </button>

                <Link
                  href={session ? '/dashboard/keys' : '/login'}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-neutral-950 hover:bg-neutral-800 text-white text-xs font-bold transition cursor-pointer shadow-2xs"
                >
                  <KeyRound className="h-3 w-3" />
                  <span>{session ? (isId ? 'Kunci API' : 'API Keys') : (isId ? 'Dapatkan Kunci' : 'Get Key')}</span>
                </Link>
              </div>
            </div>
          </section>

          {/* SECTION 4: IDE SETUP */}
          <section id="ide-setup" className="scroll-mt-32 sm:scroll-mt-36 space-y-4">
            <h2 className="text-xl sm:text-2xl font-heading font-bold text-neutral-950 pb-2 border-b border-neutral-100">
              {isId ? 'Integrasi Editor & Coding Agent' : 'IDE & Coding Agents Setup'}
            </h2>

            <p className="text-sm text-neutral-600 leading-relaxed">
              {isId
                ? 'Pilih editor coding Anda di bawah ini untuk melihat jalur pengaturan dan snippet konfigurasi yang tepat:'
                : 'Select your coding editor below to view exact setup paths and configuration snippets:'}
            </p>

            {/* Apple/shadcn segmented tab bar */}
            <div className="border border-neutral-200 rounded-2xl overflow-hidden">
              <div className="flex items-center gap-1 p-2 bg-neutral-50 border-b border-neutral-200 overflow-x-auto">
                {(Object.keys(ideConfigs) as IdeKey[]).map((key) => {
                  const cfg = ideConfigs[key];
                  const isActive = activeIde === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setActiveIde(key)}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
                        isActive
                          ? 'bg-white text-neutral-950 shadow-2xs font-bold'
                          : 'text-neutral-600 hover:text-neutral-950 hover:bg-neutral-200/50'
                      }`}
                    >
                      {cfg.name}
                    </button>
                  );
                })}
              </div>

              <div className="p-5 space-y-3">
                <div className="space-y-1">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                    <h3 className="font-bold text-sm sm:text-base text-neutral-950">
                      {ideConfigs[activeIde].title}
                    </h3>
                    {(activeIde === 'claudecode' || activeIde === 'opencode' || activeIde === 'aider') && (
                      <OsSelector
                        selectedOs={selectedOs}
                        onSelectOs={setSelectedOs}
                        selectedWinShell={selectedWinShell}
                        onSelectWinShell={setSelectedWinShell}
                        isId={isId}
                      />
                    )}
                  </div>
                  <p className="text-xs text-neutral-600">
                    {isId ? ideConfigs[activeIde].desc : ideConfigs[activeIde].descEn}
                  </p>
                </div>

                <div className="p-2.5 rounded-lg bg-neutral-100/80 font-mono text-xs text-neutral-700 flex items-center gap-2">
                  <span className="text-neutral-500 font-bold uppercase text-[10px]">Path:</span>
                  <span className="truncate">{ideConfigs[activeIde].menuPath}</span>
                </div>

                <CodeBlock
                  filename={ideConfigs[activeIde].file}
                  language={ideConfigs[activeIde].language || 'json'}
                  code={ideConfigs[activeIde].code}
                />

                {ideConfigs[activeIde].extraCode && (
                  <CodeBlock
                    filename={ideConfigs[activeIde].extraFile}
                    language={ideConfigs[activeIde].extraLanguage}
                    code={ideConfigs[activeIde].extraCode!}
                  />
                )}
              </div>
            </div>
          </section>

          {/* SECTION 4: SDKS */}
          <section id="sdk-integration" className="scroll-mt-32 sm:scroll-mt-36 space-y-4">
            <h2 className="text-xl sm:text-2xl font-heading font-bold text-neutral-950 pb-2 border-b border-neutral-100">
              {isId ? 'SDK & Kode Bahasa Pemrograman' : 'Libraries & Language SDKs'}
            </h2>

            <p className="text-sm text-neutral-600 leading-relaxed">
              {isId
                ? 'Gunakan library resmi OpenAI di TypeScript atau Python tanpa library proprietary pihak ketiga:'
                : 'Use official OpenAI libraries in TypeScript or Python without third-party proprietary wrappers:'}
            </p>

            <div className="border border-neutral-200 rounded-2xl overflow-hidden">
              <div className="flex items-center gap-1 p-2 bg-neutral-50 border-b border-neutral-200 overflow-x-auto">
                <button
                  type="button"
                  onClick={() => setActiveSdk('ts')}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
                    activeSdk === 'ts'
                      ? 'bg-white text-neutral-950 shadow-2xs font-bold'
                      : 'text-neutral-600 hover:text-neutral-950 hover:bg-neutral-200/50'
                  }`}
                >
                  TypeScript / Node.js
                </button>
                <button
                  type="button"
                  onClick={() => setActiveSdk('python')}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
                    activeSdk === 'python'
                      ? 'bg-white text-neutral-950 shadow-2xs font-bold'
                      : 'text-neutral-600 hover:text-neutral-950 hover:bg-neutral-200/50'
                  }`}
                >
                  Python (openai)
                </button>
                <button
                  type="button"
                  onClick={() => setActiveSdk('curl')}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
                    activeSdk === 'curl'
                      ? 'bg-white text-neutral-950 shadow-2xs font-bold'
                      : 'text-neutral-600 hover:text-neutral-950 hover:bg-neutral-200/50'
                  }`}
                >
                  cURL / Raw HTTP
                </button>
              </div>

              <div className="p-5">
                {activeSdk === 'ts' && (
                  <div className="space-y-2">
                    <div className="p-2 rounded-lg bg-neutral-100 font-mono text-xs text-neutral-800">
                      npm install openai
                    </div>
                    <CodeBlock
                      filename="gateway-client.ts"
                      language="typescript"
                      code={tsCode}
                    />
                  </div>
                )}

                {activeSdk === 'python' && (
                  <div className="space-y-2">
                    <div className="p-2 rounded-lg bg-neutral-100 font-mono text-xs text-neutral-800 flex items-center justify-between">
                      <span>{selectedOs === 'windows' ? 'pip install openai' : 'pip3 install openai'}</span>
                      <span className="text-[10px] text-neutral-400 font-sans">{selectedOs === 'windows' ? 'Windows' : 'macOS / Linux'}</span>
                    </div>
                    <CodeBlock
                      filename="quickstart.py"
                      language="python"
                      code={pythonCode}
                    />
                  </div>
                )}

                {activeSdk === 'curl' && (
                  <div className="space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                      <span className="text-xs text-neutral-600 font-medium">
                        {isId ? 'Format terminal sesuai sistem operasi Anda:' : 'Select terminal syntax for your OS:'}
                      </span>
                      <OsSelector
                        selectedOs={selectedOs}
                        onSelectOs={setSelectedOs}
                        selectedWinShell={selectedWinShell}
                        onSelectWinShell={setSelectedWinShell}
                        isId={isId}
                      />
                    </div>
                    <CodeBlock
                      filename={curlSdkSnippet.filename}
                      language={curlSdkSnippet.language}
                      code={curlSdkSnippet.code}
                    />
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* SECTION 5: API REFERENCE */}
          <section id="endpoint-chat" className="scroll-mt-32 sm:scroll-mt-36 space-y-6">
            <h2 className="text-xl sm:text-2xl font-heading font-bold text-neutral-950 pb-2 border-b border-neutral-100">
              {isId ? 'Referensi API Endpoint' : 'API Reference'}
            </h2>

            {/* Route 1: POST /v1/chat/completions */}
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded text-xs font-mono font-bold bg-emerald-100 text-emerald-800">
                  POST
                </span>
                <span className="font-mono text-sm font-bold text-neutral-950">
                  /v1/chat/completions
                </span>
              </div>

              <p className="text-xs sm:text-sm text-neutral-600 leading-relaxed">
                {isId
                  ? 'Membuat respon chat completion dari model AI. Mendukung konteks percakapan multi-turn, SSE streaming, dan parameter sampling standar.'
                  : 'Creates a model response for the given chat conversation. Supports multi-turn context, SSE streaming, and sampling parameters.'}
              </p>

              {/* Headers Table */}
              <div id="chat-headers" className="scroll-mt-36 space-y-2">
                <div className="text-[11px] font-mono font-bold text-neutral-500 uppercase tracking-wider">
                  Request Headers
                </div>
                <div className="border border-neutral-200 rounded-xl overflow-hidden text-xs">
                  <table className="w-full text-left">
                    <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-500 font-semibold">
                      <tr>
                        <th className="p-3">Header</th>
                        <th className="p-3">Tipe</th>
                        <th className="p-3">Keterangan</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100 text-neutral-700">
                      <tr>
                        <td className="p-3 font-mono font-bold text-neutral-950">Authorization</td>
                        <td className="p-3 font-mono text-neutral-500">string</td>
                        <td className="p-3">Format wajib: <code className="font-mono bg-neutral-100 px-1 rounded">Bearer mp-live-xxxx</code></td>
                      </tr>
                      <tr>
                        <td className="p-3 font-mono font-bold text-neutral-950">Content-Type</td>
                        <td className="p-3 font-mono text-neutral-500">string</td>
                        <td className="p-3">Wajib: <code className="font-mono bg-neutral-100 px-1 rounded">application/json</code></td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Body Parameters Table */}
              <div id="chat-params" className="scroll-mt-36 space-y-2 pt-2">
                <div className="text-[11px] font-mono font-bold text-neutral-500 uppercase tracking-wider">
                  Request Body Parameters
                </div>
                <div className="border border-neutral-200 rounded-xl overflow-hidden text-xs">
                  <table className="w-full text-left">
                    <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-500 font-semibold">
                      <tr>
                        <th className="p-3">Field</th>
                        <th className="p-3">Tipe</th>
                        <th className="p-3">Status</th>
                        <th className="p-3">Deskripsi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100 text-neutral-700">
                      <tr>
                        <td className="p-3 font-mono font-bold text-neutral-950">model</td>
                        <td className="p-3 font-mono text-neutral-500">string</td>
                        <td className="p-3 text-red-600 font-bold">Required</td>
                        <td className="p-3">ID Model resmi (misal: <code className="font-mono bg-neutral-100 px-1 rounded">deepseek-v4</code>, <code className="font-mono bg-neutral-100 px-1 rounded">kimi-coding</code>).</td>
                      </tr>
                      <tr>
                        <td className="p-3 font-mono font-bold text-neutral-950">messages</td>
                        <td className="p-3 font-mono text-neutral-500">array</td>
                        <td className="p-3 text-red-600 font-bold">Required</td>
                        <td className="p-3">Array objek pesan percakapan dengan properti <code className="font-mono bg-neutral-100 px-1 rounded">role</code> dan <code className="font-mono bg-neutral-100 px-1 rounded">content</code>.</td>
                      </tr>
                      <tr>
                        <td className="p-3 font-mono font-bold text-neutral-950">stream</td>
                        <td className="p-3 font-mono text-neutral-500">boolean</td>
                        <td className="p-3 text-neutral-500">Optional</td>
                        <td className="p-3">Jika true, gateway mengirim token chunks via Server-Sent Events (SSE). Default: false.</td>
                      </tr>
                      <tr>
                        <td className="p-3 font-mono font-bold text-neutral-950">temperature</td>
                        <td className="p-3 font-mono text-neutral-500">number</td>
                        <td className="p-3 text-neutral-500">Optional</td>
                        <td className="p-3">Tingkat variasi respon (0.0 sampai 2.0). Disarankan 0.0 - 0.3 untuk tugas coding presisi.</td>
                      </tr>
                      <tr>
                        <td className="p-3 font-mono font-bold text-neutral-950">max_tokens</td>
                        <td className="p-3 font-mono text-neutral-500">integer</td>
                        <td className="p-3 text-neutral-500">Optional</td>
                        <td className="p-3">Batas maksimum output token yang digenerasikan oleh model.</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Route 2: GET /v1/models */}
            <div id="endpoint-models" className="scroll-mt-36 space-y-3 pt-6 border-t border-neutral-100">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded text-xs font-mono font-bold bg-blue-100 text-blue-800">
                  GET
                </span>
                <span className="font-mono text-sm font-bold text-neutral-950">
                  /v1/models
                </span>
              </div>

              <p className="text-xs sm:text-sm text-neutral-600 leading-relaxed">
                {isId
                  ? 'Menampilkan daftar seluruh model AI aktif yang didukung oleh Morphic AI Gateway.'
                  : 'Lists all available models currently supported and routed by Morphic AI Gateway.'}
              </p>

              <div id="models-spec" className="scroll-mt-36">
                <CodeBlock
                  filename="models_response.json"
                  language="json"
                  code={`// GET ${BASE_URL}/models
// Header: Authorization: Bearer mp-live-xxxx

{
  "object": "list",
  "data": [
    {
      "id": "deepseek-v4",
      "object": "model",
      "created": 1740000000,
      "owned_by": "morphic"
    },
    {
      "id": "kimi-coding",
      "object": "model",
      "created": 1740000000,
      "owned_by": "morphic"
    },
    {
      "id": "qwen-max",
      "object": "model",
      "created": 1740000000,
      "owned_by": "morphic"
    }
  ]
}`}
                />
              </div>
            </div>
          </section>

          {/* SECTION 6: MODEL IDS CATALOG */}
          <section id="model-ids" className="scroll-mt-32 sm:scroll-mt-36 space-y-4">
            <h2 className="text-xl sm:text-2xl font-heading font-bold text-neutral-950 pb-2 border-b border-neutral-100">
              {isId ? 'Model ID Resmi & Karakteristik' : 'Official Model IDs'}
            </h2>

            <div className="border border-neutral-200 rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs sm:text-sm">
                  <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-500 font-semibold">
                    <tr>
                      <th className="p-3 sm:p-3.5">Model ID</th>
                      <th className="p-3 sm:p-3.5">Provider</th>
                      <th className="p-3 sm:p-3.5">Context</th>
                      <th className="p-3 sm:p-3.5">Use Case</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100 text-neutral-700">
                    <tr>
                      <td className="p-3 sm:p-3.5 font-mono font-bold text-neutral-950">
                        deepseek-v4
                      </td>
                      <td className="p-3 sm:p-3.5">DeepSeek</td>
                      <td className="p-3 sm:p-3.5 font-mono">64K</td>
                      <td className="p-3 sm:p-3.5 text-xs text-neutral-600">
                        Paling hemat & responsif. Ideal untuk auto-complete Cursor dan routine coding.
                      </td>
                    </tr>
                    <tr>
                      <td className="p-3 sm:p-3.5 font-mono font-bold text-neutral-950">
                        kimi-coding
                      </td>
                      <td className="p-3 sm:p-3.5">Kimi</td>
                      <td className="p-3 sm:p-3.5 font-mono">256K</td>
                      <td className="p-3 sm:p-3.5 text-xs text-neutral-600">
                        Konteks terpanjang di katalog. Untuk refactoring multi-file dan membaca repo besar sekaligus.
                      </td>
                    </tr>
                    <tr>
                      <td className="p-3 sm:p-3.5 font-mono font-bold text-neutral-950">
                        qwen-max
                      </td>
                      <td className="p-3 sm:p-3.5">Qwen</td>
                      <td className="p-3 sm:p-3.5 font-mono">32K</td>
                      <td className="p-3 sm:p-3.5 text-xs text-neutral-600">
                        Kuat dalam logika matematika, data engineering, dan database schema design.
                      </td>
                    </tr>
                    <tr>
                      <td className="p-3 sm:p-3.5 font-mono font-bold text-neutral-950">
                        DeepSeek-V4-Flash-0731
                      </td>
                      <td className="p-3 sm:p-3.5">Dahl</td>
                      <td className="p-3 sm:p-3.5 font-mono">64K</td>
                      <td className="p-3 sm:p-3.5 text-xs text-neutral-600">
                        Varian Flash dari DeepSeek V4, tanpa dukungan vision.
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="p-3 bg-neutral-50 border-t border-neutral-200 flex items-center justify-between text-xs">
                <span className="text-neutral-500">
                  {isId ? 'Ingin mengecek seluruh tarif per 1M token?' : 'Explore all rates and experimental models'}
                </span>
                <Link
                  href="/models"
                  className="font-bold text-neutral-950 hover:underline flex items-center gap-1"
                >
                  <span>{isId ? 'Lihat Katalog Model' : 'View Models'}</span>
                  <ArrowRight className="h-3 w-3" />
                </Link>
              </div>
            </div>
          </section>

          {/* SECTION 7: ERROR CODES */}
          <section id="error-codes" className="scroll-mt-32 sm:scroll-mt-36 space-y-4">
            <h2 className="text-xl sm:text-2xl font-heading font-bold text-neutral-950 pb-2 border-b border-neutral-100">
              {isId ? 'Kode Error HTTP & Pemecahan Masalah' : 'HTTP Error Codes & Troubleshooting'}
            </h2>

            <div className="border border-neutral-200 rounded-xl overflow-hidden">
              <table className="w-full text-left text-xs sm:text-sm">
                <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-500 font-semibold">
                  <tr>
                    <th className="p-3 sm:p-3.5">Status</th>
                    <th className="p-3 sm:p-3.5">Kode</th>
                    <th className="p-3 sm:p-3.5">Penyebab</th>
                    <th className="p-3 sm:p-3.5">Solusi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 text-neutral-700">
                  <tr id="err-401" className="scroll-mt-36">
                    <td className="p-3 sm:p-3.5 font-mono font-bold text-amber-800">
                      401 Unauthorized
                    </td>
                    <td className="p-3 sm:p-3.5 font-mono text-neutral-900 font-semibold">
                      INVALID_KEY_FORMAT
                    </td>
                    <td className="p-3 sm:p-3.5 text-xs text-neutral-600">
                      Header Authorization tidak ada, tidak berawalan <code className="font-mono bg-neutral-100 px-1 rounded">mp-</code>, atau key sudah dicabut.
                    </td>
                    <td className="p-3 sm:p-3.5 text-xs text-neutral-950 font-medium">
                      Periksa kunci di Dashboard API Keys atau generate key baru.
                    </td>
                  </tr>
                  <tr>
                    <td className="p-3 sm:p-3.5 font-mono font-bold text-rose-800">
                      402 Payment Required
                    </td>
                    <td className="p-3 sm:p-3.5 font-mono text-neutral-900 font-semibold">
                      INSUFFICIENT_CREDITS
                    </td>
                    <td className="p-3 sm:p-3.5 text-xs text-neutral-600">
                      Saldo kredit akun Anda habis (&le; 0).
                    </td>
                    <td className="p-3 sm:p-3.5 text-xs text-neutral-950 font-medium">
                      Top up saldo via QRIS instan di menu Billing.
                    </td>
                  </tr>
                  <tr id="err-429" className="scroll-mt-36">
                    <td className="p-3 sm:p-3.5 font-mono font-bold text-amber-800">
                      429 Too Many Requests
                    </td>
                    <td className="p-3 sm:p-3.5 font-mono text-neutral-900 font-semibold">
                      RATE_LIMIT_EXCEEDED
                    </td>
                    <td className="p-3 sm:p-3.5 text-xs text-neutral-600">
                      Batas request per menit (RPM) akun telah tercapai.
                    </td>
                    <td className="p-3 sm:p-3.5 text-xs text-neutral-950 font-medium">
                      Tambahkan exponential retry backoff pada client Anda.
                    </td>
                  </tr>
                  <tr id="err-503" className="scroll-mt-36">
                    <td className="p-3 sm:p-3.5 font-mono font-bold text-neutral-800">
                      503 Service Unavailable
                    </td>
                    <td className="p-3 sm:p-3.5 font-mono text-neutral-900 font-semibold">
                      UPSTREAM_TIMEOUT
                    </td>
                    <td className="p-3 sm:p-3.5 text-xs text-neutral-600">
                      Server provider upstream sedang overload atau antrean penuh.
                    </td>
                    <td className="p-3 sm:p-3.5 text-xs text-neutral-950 font-medium">
                      Gateway melakukan retry otomatis; jika berlanjut, alihkan sementara ke model alternatif.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Trailing slash tip */}
            <div className="p-3.5 rounded-xl bg-amber-50/70 border border-amber-200/80 text-amber-900 flex items-start gap-2.5 text-xs">
              <HelpCircle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
              <p className="leading-relaxed">
                <strong className="font-semibold text-amber-950">Penting:</strong>{' '}
                {isId
                  ? 'Jika Cursor menampilkan peringatan "Connection failed", pastikan tidak menambahkan garis miring di akhir URL: gunakan persis ${BASE_URL} (bukan .../v1/).'
                  : 'If Cursor displays "Connection failed", ensure there is no trailing slash: use strictly ${BASE_URL} (not .../v1/).'}
              </p>
            </div>
          </section>

          {/* SECTION 8: BEST PRACTICES */}
          <section id="security" className="scroll-mt-32 sm:scroll-mt-36 space-y-4">
            <h2 className="text-xl sm:text-2xl font-heading font-bold text-neutral-950 pb-2 border-b border-neutral-100">
              {isId ? 'Praktik Terbaik Keamanan' : 'Security Best Practices'}
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div id="sec-env" className="scroll-mt-36 p-4 rounded-xl border border-neutral-200 space-y-1.5">
                <div className="flex items-center gap-2 font-bold text-xs text-neutral-950">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <span>{isId ? 'Gunakan Environment Variables' : 'Use Environment Variables'}</span>
                </div>
                <p className="text-xs text-neutral-600 leading-relaxed">
                  {isId
                    ? 'Jangan pernah commit API Key langsung di repositori publik. Simpan di .env.local dan pastikan terdaftar di .gitignore.'
                    : 'Never commit API keys into public repositories. Store them in .env.local and add it to your .gitignore.'}
                </p>
              </div>

              <div id="sec-keys" className="scroll-mt-36 p-4 rounded-xl border border-neutral-200 space-y-1.5">
                <div className="flex items-center gap-2 font-bold text-xs text-neutral-950">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  <span>{isId ? 'Pisahkan Key Dev & Production' : 'Separate Dev & Production Keys'}</span>
                </div>
                <p className="text-xs text-neutral-600 leading-relaxed">
                  {isId
                    ? 'Buat key terpisah untuk laptop kerja harian dan server produksi agar dapat direvoke secara independen saat darurat.'
                    : 'Create dedicated keys for local workstations and production servers to enable isolated key revocation.'}
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
