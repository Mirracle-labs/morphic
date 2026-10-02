'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Loader2, Copy, Check, X } from 'lucide-react';
import { testApiKeyPingAction, getActiveModelsForTesting, TestPingResult } from '@/lib/actions';
import { useTranslation } from '@/lib/i18n';

const DEFAULT_MODELS = [
  { id: 'deepseek-v4', name: 'DeepSeek V4' },
  { id: 'qwen-max', name: 'Qwen Max' },
  { id: 'kimi-coding', name: 'Kimi Coding' },
  { id: 'MiniMaxAI/MiniMax-M2.7', name: 'MiniMax M2.7' },
  { id: 'DeepSeek-V4-Flash-0731', name: 'DeepSeek V4 Flash' },
];

interface ApiKeyPingModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialApiKey?: string;
  availableModels?: Array<{ id: string; name: string }>;
  zIndex?: string;
}

export function ApiKeyPingModal({
  isOpen,
  onClose,
  initialApiKey = '',
  availableModels,
  zIndex,
}: ApiKeyPingModalProps) {
  const { locale } = useTranslation();
  const isId = locale === 'id';

  // The catalogue comes from the props when the caller has it, otherwise from the fetch
  // below. Derived here instead of mirrored into state so a prop change needs no sync pass.
  const [fetchedModels, setFetchedModels] = useState<Array<{ id: string; name: string }> | null>(null);
  const modelsList =
    availableModels && availableModels.length > 0
      ? availableModels
      : (fetchedModels ?? DEFAULT_MODELS);

  const [apiKey, setApiKey] = useState(initialApiKey);
  // Null until the user picks one, so the default follows the catalogue that is actually
  // loaded and a stale id can never be submitted.
  const [pickedModel, setPickedModel] = useState<string | null>(null);
  const selectedModel =
    pickedModel && modelsList.some((m) => m.id === pickedModel)
      ? pickedModel
      : (modelsList[0]?.id ?? 'deepseek-v4');
  const [prompt, setPrompt] = useState(
    isId ? 'Halo! Verifikasi koneksi AI Gateway Morphic.' : 'Hello! Testing Morphic AI Gateway connectivity.'
  );
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<TestPingResult | null>(null);
  const [showRawJson, setShowRawJson] = useState(false);
  const [copiedReply, setCopiedReply] = useState(false);

  const [prevInitialApiKey, setPrevInitialApiKey] = useState(initialApiKey);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen || (availableModels && availableModels.length > 0)) return;
    // Fetch live models from database if the caller did not pass any
    getActiveModelsForTesting()
      .then((liveModels) => {
        if (liveModels && liveModels.length > 0) setFetchedModels(liveModels);
      })
      .catch(() => {});
  }, [isOpen, availableModels]);

  if (initialApiKey !== prevInitialApiKey) {
    setPrevInitialApiKey(initialApiKey);
    setApiKey(initialApiKey);
  }

  const handleClose = useCallback(() => {
    setResult(null);
    setShowRawJson(false);
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => inputRef.current?.focus(), 50);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Keyboard accessibility: Escape key to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, handleClose]);

  if (!isOpen) return null;

  const handleTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apiKey.trim() || isLoading) return;

    setIsLoading(true);
    setResult(null);

    try {
      const res = await testApiKeyPingAction({
        apiKey: apiKey.trim(),
        model: selectedModel,
        prompt: prompt.trim(),
      });
      setResult(res);
    } catch (err: any) {
      setResult({
        ok: false,
        status: 0,
        latencyMs: 0,
        error: err?.message || (isId ? 'Gagal menghubungi gateway' : 'Failed to reach gateway'),
      });
    } finally {
      setIsLoading(false);
    }
  };

  const copyReply = () => {
    if (!result?.reply) return;
    navigator.clipboard.writeText(result.reply);
    setCopiedReply(true);
    setTimeout(() => setCopiedReply(false), 2000);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ping-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isLoading) {
          handleClose();
        }
      }}
      className={`fixed inset-0 ${zIndex || 'z-50'} bg-black/50 flex items-center justify-center p-4 animate-in fade-in duration-150`}
    >
      <div
        className="bg-white rounded-2xl border border-neutral-200 w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-100">
          <div>
            <h2 id="ping-modal-title" className="text-sm sm:text-base font-heading font-bold text-neutral-950">
              {isId ? 'Uji Koneksi API Key' : 'Test API Key'}
            </h2>
            <p className="text-xs text-neutral-500 mt-0.5">
              {isId
                ? 'Kirim satu permintaan inferensi untuk memverifikasi kunci Anda.'
                : 'Send a single inference request to verify your key.'}
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label={isId ? 'Tutup modal' : 'Close modal'}
            className="text-neutral-500 hover:text-neutral-900 transition-colors cursor-pointer p-1 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form Body */}
        <div className="p-6 overflow-y-auto space-y-4 flex-1">
          <form onSubmit={handleTest} className="space-y-4">
            {/* API Key */}
            <div className="space-y-1.5">
              <label
                htmlFor="ping-api-key"
                className="block text-xs font-semibold text-neutral-700"
              >
                API Key
              </label>
              <input
                ref={inputRef}
                id="ping-api-key"
                type="text"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="mp-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                className="w-full px-3 py-2 text-xs font-mono rounded-xl border border-neutral-200 bg-neutral-50 text-neutral-900 placeholder:text-neutral-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus:bg-white transition-colors"
                required
              />
            </div>

            {/* Target Model */}
            <div className="space-y-1.5">
              <label
                htmlFor="ping-model"
                className="block text-xs font-semibold text-neutral-700"
              >
                Model
              </label>
              <select
                id="ping-model"
                value={selectedModel}
                onChange={(e) => setPickedModel(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-neutral-50 text-neutral-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus:bg-white transition-colors cursor-pointer"
              >
                {modelsList.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.id})
                  </option>
                ))}
              </select>
            </div>

            {/* Prompt */}
            <div className="space-y-1.5">
              <label
                htmlFor="ping-prompt"
                className="block text-xs font-semibold text-neutral-700"
              >
                Prompt
              </label>
              <textarea
                id="ping-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={2}
                placeholder={isId ? 'Masukkan pesan uji coba...' : 'Enter test prompt...'}
                className="w-full px-3 py-2 text-xs rounded-xl border border-neutral-200 bg-neutral-50 text-neutral-900 placeholder:text-neutral-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus:bg-white transition-colors resize-none"
              />
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={isLoading || !apiKey.trim()}
              className="w-full px-4 py-2.5 text-xs font-semibold rounded-xl bg-neutral-950 text-white hover:bg-neutral-800 disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 cursor-pointer shadow-xs flex items-center justify-center gap-2"
            >
              {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              <span>
                {isLoading
                  ? (isId ? 'Mengirim permintaan...' : 'Sending request...')
                  : (isId ? 'Jalankan Tes' : 'Run Test')}
              </span>
            </button>
          </form>

          {/* Test Result Section */}
          {result && (
            <div className="pt-2 border-t border-neutral-100 space-y-3 animate-in fade-in duration-150">
              {result.ok ? (
                <div className="bg-neutral-50 p-4 rounded-2xl border border-neutral-200 space-y-3">
                  {/* Status Bar */}
                  <div className="flex items-center justify-between text-xs pb-2 border-b border-neutral-200/80">
                    <div className="inline-flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-500" aria-hidden="true" />
                      <span className="font-semibold text-neutral-950 font-mono text-[11px]">200 OK</span>
                    </div>
                    <div className="flex items-center gap-3 text-[11px] font-mono text-neutral-500">
                      <span>{result.latencyMs} ms</span>
                      {result.usage && (
                        <span>{result.usage.totalTokens} tokens</span>
                      )}
                    </div>
                  </div>

                  {/* Output content */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] text-neutral-500">
                      <span>{result.model}</span>
                      <button
                        type="button"
                        onClick={copyReply}
                        className="inline-flex items-center gap-1 text-[11px] text-neutral-600 hover:text-neutral-950 cursor-pointer"
                      >
                        {copiedReply ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                        <span>{copiedReply ? (isId ? 'Tersalin' : 'Copied') : (isId ? 'Salin' : 'Copy')}</span>
                      </button>
                    </div>
                    <div className="bg-white p-3 rounded-xl border border-neutral-200 text-xs text-neutral-900 leading-relaxed whitespace-pre-wrap">
                      {result.reply}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-neutral-50 p-4 rounded-2xl border border-neutral-200 space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <div className="inline-flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-red-500" aria-hidden="true" />
                      <span className="font-semibold text-neutral-950 font-mono text-[11px]">
                        {result.status > 0 ? `HTTP ${result.status} ${result.code || ''}`.trim() : (isId ? 'Gagal Terhubung' : 'Connection Failed')}
                      </span>
                    </div>
                    {result.latencyMs > 0 && (
                      <span className="font-mono text-[11px] text-neutral-500">{result.latencyMs} ms</span>
                    )}
                  </div>

                  <div className="bg-white p-3 rounded-xl border border-neutral-200 text-xs font-mono text-neutral-800 leading-relaxed">
                    {result.error}
                  </div>

                  {result.status === 402 && (
                    <p className="text-xs text-neutral-500">
                      {isId
                        ? 'Saldo akun tidak mencukupi untuk melakukan panggilan model ini. Silakan top up di menu Billing.'
                        : 'Insufficient balance to run this model. Please add credits in the Billing section.'}
                    </p>
                  )}
                  {result.status === 401 && (
                    <p className="text-xs text-neutral-500">
                      {isId
                        ? 'API key tidak valid atau sudah dicabut. Pastikan kunci yang dimasukkan aktif.'
                        : 'Invalid or revoked API key. Make sure to use an active key.'}
                    </p>
                  )}
                </div>
              )}

              {/* Raw JSON Debug View */}
              {result.rawJson && (
                <div className="pt-1">
                  <button
                    type="button"
                    onClick={() => setShowRawJson(!showRawJson)}
                    className="text-[11px] font-mono text-neutral-500 hover:text-neutral-900 transition-colors cursor-pointer"
                  >
                    {showRawJson ? '[-] Sembunyikan JSON' : '[+] Tampilkan Raw JSON'}
                  </button>
                  {showRawJson && (
                    <pre className="mt-2 p-3 bg-neutral-950 text-neutral-200 rounded-xl text-[10px] font-mono overflow-x-auto max-h-40 border border-neutral-800">
                      {JSON.stringify(result.rawJson, null, 2)}
                    </pre>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
