import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCredits(n: number): string {
  return n.toLocaleString('en-US');
}

export function formatTokens(n: number): string {
  return n.toLocaleString('en-US');
}

export function formatTokenEstimate(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return Math.round(n).toString();
}

export function timeAgo(date: Date | string | null, locale: string = 'en'): string {
  const isId = locale === 'id';
  if (!date) return isId ? 'belum pernah' : 'never';
  const d = typeof date === 'string' ? new Date(date) : date;
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return isId ? 'baru saja' : 'just now';
  if (secs < 3600) {
    const mins = Math.floor(secs / 60);
    return isId ? `${mins} mnt lalu` : `${mins}m ago`;
  }
  if (secs < 86400) {
    const hours = Math.floor(secs / 3600);
    return isId ? `${hours} jam lalu` : `${hours}h ago`;
  }
  const days = Math.floor(secs / 86400);
  return isId ? `${days} hari lalu` : `${days}d ago`;
}

// Public gateway URL shown to users and put in copy-paste snippets. Deliberately separate from
// NEXT_PUBLIC_API_URL, which is the internal backend address (localhost:8787 in development).
export const API_BASE_URL = `${(process.env.NEXT_PUBLIC_GATEWAY_URL || 'https://morphic-api.web.id').replace(/\/+$/, '')}/v1`;

export const CHAT_COMPLETIONS_URL = `${API_BASE_URL}/chat/completions`;

