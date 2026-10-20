'use client';

import { useCallback, useSyncExternalStore } from 'react';

// Per-browser value that renders null on the server and in the first client pass (no hydration
// mismatch), then the stored value. Storage can be blocked, so every access is guarded.
const EVENT = 'morphic:local-storage';

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const subscribe = (cb: () => void) => {
  window.addEventListener('storage', cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener('storage', cb);
    window.removeEventListener(EVENT, cb);
  };
};

export function useLocalStorage(key: string): [string | null, (value: string) => void] {
  const value = useSyncExternalStore(subscribe, () => read(key), () => null);
  const set = useCallback(
    (v: string) => {
      try {
        localStorage.setItem(key, v);
      } catch {}
      window.dispatchEvent(new Event(EVENT));
    },
    [key],
  );
  return [value, set];
}
