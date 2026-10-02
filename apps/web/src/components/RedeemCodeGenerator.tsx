'use client';

import { useActionState, useState, type ReactNode } from 'react';
import { Check, Copy, Loader2, Minus, Plus } from 'lucide-react';
import { createRedeemCodes, type GenerateCodesState } from '@/lib/admin-actions';
import { useTranslation } from '@/lib/i18n';
import { formatCredits } from '@/lib/utils';

export interface GeneratorPackage {
  id: string;
  name: string;
  creditAllowance: number;
}

const INITIAL: GenerateCodesState = { ok: false, message: '', codes: [] };
const CREDIT_PRESETS = [10_000, 100_000, 1_000_000, 5_000_000];
const USE_PRESETS: Array<number | null> = [1, 10, 100, null];
const EXPIRY_PRESETS = [0, 7, 30, 90];

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-xl px-3 py-2 text-xs font-semibold transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-1 ${
        active
          ? 'bg-neutral-950 text-white'
          : 'border border-neutral-200 bg-white text-neutral-700 hover:border-neutral-950 hover:text-neutral-950'
      }`}
    >
      {children}
    </button>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-xs font-semibold text-neutral-500">{label}</div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

export function CopyChip({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
      aria-label={label ?? `Copy ${text}`}
      className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 px-2 py-1 text-[11px] font-semibold text-neutral-700 hover:border-neutral-950 hover:text-neutral-950 cursor-pointer transition-colors"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {label}
    </button>
  );
}

export function RedeemCodeGenerator({ packages }: { packages: GeneratorPackage[] }) {
  const { locale } = useTranslation();
  const en = locale === 'en';
  const [state, formAction, pending] = useActionState(createRedeemCodes, INITIAL);

  const [reward, setReward] = useState<{ type: 'credits'; amount: number } | { type: 'package'; id: string }>({
    type: 'credits',
    amount: 100_000,
  });
  const [customAmount, setCustomAmount] = useState('');
  const [count, setCount] = useState(1);
  const [uses, setUses] = useState<number | null>(1);
  const [days, setDays] = useState(0);
  const [prefix, setPrefix] = useState('');

  const creditAmount = reward.type === 'credits' ? (customAmount ? Number(customAmount) : reward.amount) : 0;
  const pkg = reward.type === 'package' ? packages.find((p) => p.id === reward.id) : undefined;
  const clampCount = (n: number) => Math.min(500, Math.max(1, Number.isFinite(n) ? Math.round(n) : 1));

  const summary = [
    en ? `${count} code${count > 1 ? 's' : ''}` : `${count} kode`,
    reward.type === 'credits' ? `${formatCredits(creditAmount || 0)} ${en ? 'credits' : 'kredit'}` : (pkg?.name ?? '-'),
    uses === null ? (en ? 'unlimited uses' : 'tanpa batas') : `${uses}× ${en ? 'use' : 'pakai'}`,
    days ? (en ? `${days} days` : `${days} hari`) : en ? 'no expiry' : 'selamanya',
  ].join(' · ');

  return (
    <div className="space-y-5">
      <form action={formAction} className="space-y-5">
        <input type="hidden" name="rewardType" value={reward.type} />
        {reward.type === 'credits' && <input type="hidden" name="creditAmount" value={creditAmount || ''} />}
        {reward.type === 'package' && <input type="hidden" name="packageId" value={reward.id} />}
        <input type="hidden" name="count" value={count} />
        <input type="hidden" name="maxRedemptions" value={uses ?? ''} />
        <input type="hidden" name="expiresInDays" value={days} />

        <Field label={en ? 'Reward: credits' : 'Hadiah: kredit'}>
          {CREDIT_PRESETS.map((n) => (
            <Chip
              key={n}
              active={reward.type === 'credits' && !customAmount && reward.amount === n}
              onClick={() => {
                setReward({ type: 'credits', amount: n });
                setCustomAmount('');
              }}
            >
              {n >= 1_000_000 ? `${n / 1_000_000}M` : `${n / 1_000}K`}
            </Chip>
          ))}
          <input
            type="number"
            inputMode="numeric"
            min={1}
            max={100000000}
            value={customAmount}
            onChange={(e) => {
              setCustomAmount(e.target.value);
              setReward({ type: 'credits', amount: Number(e.target.value) || 0 });
            }}
            placeholder={en ? 'Custom' : 'Lainnya'}
            aria-label={en ? 'Custom credit amount' : 'Jumlah kredit lain'}
            className={`w-28 rounded-xl border px-3 py-2 text-xs font-mono focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 ${
              customAmount ? 'border-neutral-950' : 'border-neutral-200'
            }`}
          />
        </Field>

        {packages.length > 0 && (
          <Field label={en ? 'Or a package' : 'Atau paket'}>
            {packages.map((p) => (
              <Chip
                key={p.id}
                active={reward.type === 'package' && reward.id === p.id}
                onClick={() => setReward({ type: 'package', id: p.id })}
              >
                {p.name}
              </Chip>
            ))}
          </Field>
        )}

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label={en ? 'How many codes' : 'Jumlah kode'}>
            <div className="inline-flex items-center rounded-xl border border-neutral-200 bg-white">
              <button
                type="button"
                onClick={() => setCount((c) => clampCount(c - 1))}
                aria-label={en ? 'Fewer codes' : 'Kurangi'}
                className="grid h-9 w-9 place-items-center text-neutral-700 hover:text-neutral-950 cursor-pointer"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <input
                type="number"
                min={1}
                max={500}
                value={count}
                onChange={(e) => setCount(clampCount(Number(e.target.value)))}
                aria-label={en ? 'Number of codes' : 'Jumlah kode'}
                className="w-12 bg-transparent text-center text-sm font-bold tabular-nums focus:outline-none"
              />
              <button
                type="button"
                onClick={() => setCount((c) => clampCount(c + 1))}
                aria-label={en ? 'More codes' : 'Tambah'}
                className="grid h-9 w-9 place-items-center text-neutral-700 hover:text-neutral-950 cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            {[10, 50].map((n) => (
              <Chip key={n} active={count === n} onClick={() => setCount(n)}>
                {n}
              </Chip>
            ))}
          </Field>

          <Field label={en ? 'Uses per code' : 'Pemakaian per kode'}>
            {USE_PRESETS.map((n) => (
              <Chip key={String(n)} active={uses === n} onClick={() => setUses(n)}>
                {n === null ? '∞' : `${n}×`}
              </Chip>
            ))}
          </Field>

          <Field label={en ? 'Valid for' : 'Berlaku'}>
            {EXPIRY_PRESETS.map((d) => (
              <Chip key={d} active={days === d} onClick={() => setDays(d)}>
                {d === 0 ? (en ? 'Forever' : 'Selamanya') : en ? `${d} days` : `${d} hari`}
              </Chip>
            ))}
          </Field>

          <div>
            <label htmlFor="gen-prefix" className="mb-2 block text-xs font-semibold text-neutral-500">
              {en ? 'Custom code (optional)' : 'Kode sendiri (opsional)'}
            </label>
            <input
              id="gen-prefix"
              name="prefix"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, ''))}
              maxLength={32}
              placeholder={en ? 'Empty = random' : 'Kosong = acak'}
              className="w-full rounded-xl border border-neutral-200 bg-white px-3 py-2 text-xs font-mono uppercase focus:outline-none focus:border-neutral-950 focus-visible:ring-2 focus-visible:ring-neutral-950"
            />
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t border-neutral-100 pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-neutral-600">{summary}</p>
          <button
            type="submit"
            disabled={pending || (reward.type === 'credits' && !(creditAmount > 0))}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-neutral-950 px-6 py-3 text-sm font-bold text-white transition-colors hover:bg-neutral-800 disabled:opacity-50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-950 focus-visible:ring-offset-2"
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {en ? 'Generate' : 'Buat kode'}
          </button>
        </div>
      </form>

      {state.message && (
        <div
          role="status"
          className={`rounded-2xl border p-4 text-xs animate-in fade-in slide-in-from-top-1 duration-200 ${
            state.ok ? 'border-neutral-950 bg-neutral-50 text-neutral-900' : 'border-red-200 bg-red-50 text-red-700'
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <span className="font-bold">{state.message}</span>
            {state.ok && state.codes.length > 1 && (
              <CopyChip text={state.codes.join('\n')} label={en ? 'Copy all' : 'Salin semua'} />
            )}
          </div>
          {state.ok && state.codes.length > 0 && (
            <ul className="mt-3 max-h-56 space-y-1.5 overflow-auto">
              {state.codes.map((c) => (
                <li key={c} className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 border border-neutral-200">
                  <span className="font-mono text-sm font-bold text-neutral-950 select-all">{c}</span>
                  <CopyChip text={c} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
