import { useDeferredValue, useMemo, useState } from 'react';

// Client-side search over rows the page already has: no refetch, no extra bandwidth.
// Every term must match (AND). A plain word matches the start of a word, so "ready" does not hit
// "unready"; a term with punctuation ("k2.6", "kimi-k2", "z.ai") matches anywhere as typed.

const WORD = /[^\p{L}\p{N}]+/u;

export interface SearchIndex {
  text: string;
  words: string[];
}

export function indexText(...parts: (string | null | undefined)[]): SearchIndex {
  const text = parts.filter(Boolean).join(' ').toLowerCase();
  return { text, words: text.split(WORD).filter(Boolean) };
}

export function matches(index: SearchIndex, query: string): boolean {
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((t) => (WORD.test(t) ? index.text.includes(t) : index.words.some((w) => w.startsWith(t))));
}

/** Rows filtered by the search box. `toIndex` runs once per row, not per keystroke. */
export function useTableSearch<T>(rows: T[], toIndex: (row: T) => SearchIndex) {
  const [query, setQuery] = useState('');
  // Typing stays responsive; the filter catches up in a lower-priority render.
  const deferred = useDeferredValue(query);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- toIndex is a pure mapping of the row
  const indexed = useMemo(() => rows.map((row) => ({ row, index: toIndex(row) })), [rows]);
  const filtered = useMemo(
    () => (deferred.trim() ? indexed.filter((r) => matches(r.index, deferred)).map((r) => r.row) : rows),
    [indexed, rows, deferred],
  );
  return { query, setQuery, filtered, pending: query !== deferred };
}
