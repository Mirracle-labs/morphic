// Snapshot the public model catalog from zenmux.ai/models into src/data/model-catalog.json and
// vendor every maker/provider logo into public/logos/catalog/. Run: pnpm --filter @morphic/web catalog:sync
// Only static metadata is kept; traffic, uptime and cache stats are theirs and stay out.
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const LOGO_DIR = `${ROOT}public/logos/catalog/`;
const OUT = `${ROOT}src/data/model-catalog.json`;

// Provider icon file → provider name. Icons are shared between makers and providers.
const PROVIDER_BY_ICON = {
  'alibaba-cloud': 'Alibaba Cloud', anthropic: 'Anthropic', 'atom-infinite': 'ATOM INFINITE', azure: 'Azure',
  'big-model': 'BigModel', dots: 'Dots Studio', gpt: 'OpenAI', google: 'Google Vertex', 'kat-coder': 'Streamlake',
  ling: 'Ant Ling', 'long-cat': 'LongCat', meta: 'Meta', minimax: 'MiniMax', mistral: 'Mistral', novita: 'NovitaAI',
  pixverse: 'PixVerse', sakana: 'Sakana AI', 'sapiens-al': 'Sapiens AI', skyreels: 'SkyReels', spacexai: 'xAI',
  tbox: 'Tbox', typesafe: 'TypeSafe', zai: 'Z.ai', amazon: 'Amazon Bedrock', baidu: 'Baidu', bfi: 'Black Forest Labs',
  deepseek: 'DeepSeek', hunyuan: 'TencentCloud', huoshan: 'Volcengine', jieyuexingchen: 'StepFun', keling: 'KlingAI',
  moonshot: 'Moonshot AI', sambanova: 'SambaNova', siliconflow: 'SiliconFlow', xiaomi: 'Xiaomi',
};

const iconKey = (url) => url.split('/').pop().replace(/^Property-1/, '').replace(/\.svg$/, '').toLowerCase();
const list = (s) => (s ? s.split(',').map((x) => x.trim()).filter(Boolean) : []);

/** [min, max] USD per 1M tokens across pricing tiers. Per-second/per-image items are not token prices. */
function priceRange(m, code, flat) {
  if (m.variable_pricings) {
    const rates = JSON.parse(m.variable_pricings)
      .filter((f) => f.feeItemCode === code)
      .flatMap((f) => f.feeRecords)
      .filter((r) => r.components.some((c) => c.code === 'chargeUnit' && c.value === 'millionTokens'))
      .map((r) => Number(r.feeRate))
      .filter((n) => Number.isFinite(n));
    return rates.length ? [Math.min(...rates), Math.max(...rates)] : null;
  }
  const n = Number(flat);
  return flat !== '' && Number.isFinite(n) && (n > 0 || m.isFree) ? [n, n] : null;
}

const res = await fetch('https://zenmux.ai/models', { headers: { 'user-agent': 'Mozilla/5.0' } });
if (!res.ok) throw new Error(`zenmux.ai/models: HTTP ${res.status}`);
const html = await res.text();
// The RSC flight payload carries the full list in the explorer's initialState.
const flight = [...html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)].map((m) => JSON.parse(`"${m[1]}"`)).join('');
const at = flight.lastIndexOf('"initialState":', flight.indexOf('"bannerInit":true'));
if (at < 0) throw new Error('catalog state not found; the page layout changed');
const start = at + '"initialState":'.length;
// Walk to the matching brace; JSON.parse needs the exact object.
let depth = 0, inStr = false, end = start;
for (; end < flight.length; end++) {
  const c = flight[end];
  if (inStr) { if (c === '\\') end++; else if (c === '"') inStr = false; continue; }
  if (c === '"') inStr = true;
  else if (c === '{') depth++;
  else if (c === '}' && --depth === 0) break;
}
const raw = JSON.parse(flight.slice(start, end + 1)).models;

// Long strings are hoisted out of the state as "$<id>" refs to text rows "<id>:T<hex byte length>,<text>".
// Text rows carry no trailing newline, so walk the rows in order instead of searching for the id.
const bytes = Buffer.from(flight);
const texts = new Map();
for (let pos = 0; pos < bytes.length; ) {
  const colon = bytes.indexOf(0x3a, pos); // ':'
  if (colon < 0) break;
  const id = bytes.subarray(pos, colon).toString();
  if (bytes[colon + 1] === 0x54 /* T */) {
    const comma = bytes.indexOf(0x2c, colon); // ','
    const len = parseInt(bytes.subarray(colon + 2, comma).toString(), 16);
    texts.set(id, bytes.subarray(comma + 1, comma + 1 + len).toString());
    pos = comma + 1 + len;
  } else {
    const nl = bytes.indexOf(0x0a, colon);
    pos = nl < 0 ? bytes.length : nl + 1;
  }
}
const textRow = (ref) => {
  if (!texts.has(ref.slice(1))) throw new Error(`unresolved ${ref}`);
  return texts.get(ref.slice(1));
};
for (const m of raw) for (const k of ['variable_pricings', 'description']) if (/^\$[0-9a-z]+$/.test(m[k] ?? '')) m[k] = textRow(m[k]);

const icons = new Map(); // url → local path
const logo = (url) => {
  if (!url) return null;
  if (!icons.has(url)) icons.set(url, `/logos/catalog/${iconKey(url)}.svg`);
  return icons.get(url);
};

const models = raw.map((m) => ({
  slug: m.slug,
  name: m.name.includes(': ') ? m.name.slice(m.name.indexOf(': ') + 2) : m.name,
  maker: m.authorName,
  makerLogo: logo(m.iconUrl),
  description: m.description || null,
  aliases: m.aliases ?? [],
  input: list(m.input_modalities),
  output: list(m.output_modalities),
  contextLength: Number(m.context_length) || null,
  maxOutput: Number(m.max_completion_tokens) || null,
  inputUsd: priceRange(m, 'prompt', m.pricing_prompt),
  outputUsd: priceRange(m, 'completion', m.pricing_completion),
  reasoning: Boolean(m.supports_reasoning),
  published: m.publish_time || null,
  providers: (m.providerIcons ?? []).map((u) => ({ name: PROVIDER_BY_ICON[iconKey(u)] ?? iconKey(u), logo: logo(u) })),
}));

await mkdir(LOGO_DIR, { recursive: true });
await mkdir(new URL('.', `file://${OUT}`), { recursive: true });
for (const [url, path] of icons) {
  const r = await fetch(url);
  if (!r.ok) { console.warn(`logo ${url}: HTTP ${r.status}`); continue; }
  await writeFile(`${ROOT}public${path}`, Buffer.from(await r.arrayBuffer()));
}
await writeFile(OUT, JSON.stringify({ source: 'zenmux.ai/models', syncedAt: new Date().toISOString(), models }, null, 1) + '\n');
console.log(`${models.length} models, ${icons.size} logos → ${OUT}`);
