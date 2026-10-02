'use client';

import { useSyncExternalStore } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

function subscribe(callback: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => {};
  const mql = window.matchMedia(QUERY);
  mql.addEventListener('change', callback);
  return () => mql.removeEventListener('change', callback);
}

function getSnapshot(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(QUERY).matches;
}

/** Server (and first hydration render) always reports "no preference". */
function getServerSnapshot(): boolean {
  return false;
}

/**
 * Hydration-safe reduced-motion detection. The first client render matches
 * the server output (`false`), then the real preference applies after
 * hydration completes.
 */
export function useReducedMotionSafe(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
