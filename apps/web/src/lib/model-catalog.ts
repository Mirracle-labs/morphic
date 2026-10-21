// Public catalog = the static snapshot (src/data/model-catalog.json, see scripts/sync-model-catalog.mjs)
// merged with the models we actually route. Live models keep our id, price, providers and traffic.
import type { ProviderBrand } from './gateway-providers.ts';
import type { ModelDetail } from './model-detail.ts';

export interface SnapshotModel {
  slug: string;
  name: string;
  maker: string;
  makerLogo: string | null;
  description: string | null;
  aliases: string[];
  input: string[];
  output: string[];
  contextLength: number | null;
  maxOutput: number | null;
  inputUsd: [number, number] | null;
  outputUsd: [number, number] | null;
  reasoning: boolean;
  published: string | null;
  providers: { name: string; logo: string | null }[];
}

export interface LiveModel {
  publicModelId: string;
  providerModelId: string;
  displayName: string;
  description: string | null;
  contextLength: number;
  capabilities: string[];
  inputCreditsPer1m: number;
  outputCreditsPer1m: number;
  maker: string;
  providers: ProviderBrand[];
  tokens7d: number;
  hourly: { total: number; errors: number }[];
}

export interface CatalogModel {
  /** The id a client sends: ours when live, the snapshot slug otherwise. */
  id: string;
  live: boolean;
  name: string;
  maker: string;
  makerLogo: string | null;
  description: string | null;
  input: string[];
  output: string[];
  contextLength: number | null;
  maxOutput: number | null;
  /** Live: what Morphic bills, in credits. Catalog-only: upstream list price, USD. */
  price: { unit: 'credits'; input: number; output: number } | { unit: 'usd'; input: [number, number] | null; output: [number, number] | null };
  providers: { label: string; logo: string | null }[];
  tokens7d: number;
  /** Oldest → newest, one bucket per hour over the last 24h; empty buckets when not live. */
  hourly: { total: number; errors: number }[];
}

const key = (s: string) => s.trim().toLowerCase();

/** Exact matches only: slug, slug without the maker prefix, or a listed alias. */
export function matchSnapshot(live: Pick<LiveModel, 'publicModelId' | 'providerModelId'>, snapshot: SnapshotModel[]): SnapshotModel | undefined {
  const ids = new Set([key(live.publicModelId), key(live.providerModelId)]);
  return snapshot.find(
    (m) => ids.has(key(m.slug)) || ids.has(key(m.slug.split('/').pop()!)) || m.aliases.some((a) => ids.has(key(a))),
  );
}

export function mergeCatalog(snapshot: SnapshotModel[], live: LiveModel[], hours: number): CatalogModel[] {
  const logoByName = new Map(snapshot.flatMap((m) => [[key(m.maker), m.makerLogo] as const, ...m.providers.map((p) => [key(p.name), p.logo] as const)]));
  const matched = new Map<string, LiveModel>();
  const unmatched: LiveModel[] = [];
  for (const l of live) {
    const hit = matchSnapshot(l, snapshot);
    if (hit && !matched.has(hit.slug)) matched.set(hit.slug, l);
    else unmatched.push(l);
  }

  const fromLive = (l: LiveModel, snap?: SnapshotModel): CatalogModel => ({
    id: l.publicModelId,
    live: true,
    name: snap?.name ?? l.displayName,
    maker: snap?.maker ?? l.maker,
    makerLogo: snap?.makerLogo ?? logoByName.get(key(l.maker)) ?? null,
    description: snap?.description ?? l.description,
    input: snap?.input ?? ['text'],
    output: snap?.output ?? ['text'],
    contextLength: l.contextLength,
    maxOutput: snap?.maxOutput ?? null,
    price: { unit: 'credits', input: l.inputCreditsPer1m, output: l.outputCreditsPer1m },
    // The routes we really use; borrow the snapshot's logo when our brand list has none.
    providers: l.providers.map((p) => ({ label: p.label, logo: p.logo ?? logoByName.get(key(p.label)) ?? null })),
    tokens7d: l.tokens7d,
    hourly: l.hourly,
  });

  const empty = () => Array.from({ length: hours }, () => ({ total: 0, errors: 0 }));
  return [
    ...unmatched.map((l) => fromLive(l)),
    ...snapshot.map((m) => {
      const l = matched.get(m.slug);
      if (l) return fromLive(l, m);
      return {
        id: m.slug,
        live: false,
        name: m.name,
        maker: m.maker,
        makerLogo: m.makerLogo,
        description: m.description,
        input: m.input,
        output: m.output,
        contextLength: m.contextLength,
        maxOutput: m.maxOutput,
        price: { unit: 'usd' as const, input: m.inputUsd, output: m.outputUsd },
        providers: m.providers.map((p) => ({ label: p.name, logo: p.logo })),
        tokens7d: 0,
        hourly: empty(),
      };
    }),
  ];
}

/** Detail page for a model we list but do not route yet: snapshot metadata, no traffic. */
export function snapshotDetail(m: SnapshotModel, snapshot: SnapshotModel[]): ModelDetail {
  return {
    model: {
      publicModelId: m.slug,
      displayName: m.name,
      description: m.description,
      contextLength: m.contextLength ?? 0,
      capabilities: m.reasoning ? ['reasoning'] : [],
      inputCreditsPer1m: 0,
      outputCreditsPer1m: 0,
      status: 'soon',
      replacementModelAlias: null,
      createdAt: m.published ?? '',
    },
    providers: m.providers.map((p, i) => ({ name: p.name, label: p.name, logo: p.logo, role: i === 0 ? 'primary' : 'fallback' })),
    brands: {},
    hourly: [],
    daily: [],
    activity: [],
    related: snapshot
      .filter((r) => r.maker === m.maker && r.slug !== m.slug)
      .slice(0, 6)
      .map((r) => ({ publicModelId: r.slug, displayName: r.name, description: r.description, tokens7d: 0, makerLogo: r.makerLogo })),
    meta: m,
  };
}
