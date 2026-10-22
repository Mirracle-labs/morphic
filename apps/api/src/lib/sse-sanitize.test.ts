import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GENERIC_ERROR_PAYLOAD,
  createSseSanitizer,
  sanitizeCompletionBody,
  type DropReason,
} from './sse-sanitize';

const PUBLIC = 'public-model';

function sanitizer(opts: { clientWantsUsage?: boolean } = {}) {
  const chunks: Record<string, unknown>[] = [];
  const drops: { reason: DropReason; line: string }[] = [];
  const s = createSseSanitizer({
    publicModel: PUBLIC,
    clientWantsUsage: opts.clientWantsUsage ?? false,
    onChunk: (chunk) => chunks.push(structuredClone(chunk)),
    onDrop: (reason, line) => drops.push({ reason, line }),
  });
  return { s, chunks, drops };
}

const dataLine = (value: unknown) => `data: ${JSON.stringify(value)}\n`;

test('sse-sanitize: blank lines are preserved as event delimiters', () => {
  const { s } = sanitizer();
  assert.equal(s.push('\n'), '\n');
});

test('sse-sanitize: comments become a fixed keepalive and discard their text', () => {
  const { s } = sanitizer();
  assert.equal(s.push(': upstream ping secret\n'), ': keepalive\n');
});

test('sse-sanitize: both "data:" and "data: " prefixes are accepted', () => {
  const { s } = sanitizer();
  const chunk = { model: 'x', choices: [{ delta: { content: 'ok' } }] };
  const expected = `data: ${JSON.stringify({ model: PUBLIC, choices: [{ delta: { content: 'ok' } }] })}\n`;
  assert.equal(s.push(`data:${JSON.stringify(chunk)}\n`), expected);
  assert.equal(s.push(`data: ${JSON.stringify(chunk)}\n`), expected);
});

test('sse-sanitize: empty data payloads are dropped', () => {
  const { s, chunks } = sanitizer();
  assert.equal(s.push('data:\n'), '');
  assert.equal(s.push('data:   \n'), '');
  assert.equal(chunks.length, 0);
});

test('sse-sanitize: [DONE] is forwarded', () => {
  const { s } = sanitizer();
  assert.equal(s.push('data: [DONE]\n'), 'data: [DONE]\n');
});

test('sse-sanitize: malformed JSON is dropped and reported', () => {
  const { s, drops } = sanitizer();
  assert.equal(s.push('data: {nope\n'), '');
  assert.deepEqual(drops.map((d) => d.reason), ['non_json']);
});

test('sse-sanitize: non-plain JSON (array) is dropped and reported', () => {
  const { s, drops } = sanitizer();
  assert.equal(s.push('data: [1,2,3]\n'), '');
  assert.equal(s.push('data: "string"\n'), '');
  assert.deepEqual(drops.map((d) => d.reason), ['non_json', 'non_json']);
});

test('sse-sanitize: error payloads are replaced with the generic envelope', () => {
  const { s, drops } = sanitizer();
  const out = s.push(`data: ${JSON.stringify({ error: { message: 'secret upstream detail' } })}\n`);
  assert.equal(out, `data: ${JSON.stringify(GENERIC_ERROR_PAYLOAD)}\n`);
  assert.equal(out.includes('secret upstream detail'), false);
  assert.deepEqual(drops.map((d) => d.reason), ['error_payload']);
});

test('sse-sanitize: non-data lines (event:, id:, retry:) are dropped', () => {
  const { s } = sanitizer();
  assert.equal(s.push('event: message\nid: 42\nretry: 1000\n'), '');
});

test('sse-sanitize: model is rewritten and provider identity fields are removed', () => {
  const { s } = sanitizer();
  const out = s.push(dataLine({ model: 'upstream/internal', provider: 'deepseek', system_fingerprint: 'fp_1', choices: [{ delta: { content: 'hi' } }] }));
  assert.equal(out, `data: ${JSON.stringify({ model: PUBLIC, choices: [{ delta: { content: 'hi' } }] })}\n`);
});

test('sse-sanitize Case A: usage-only chunk is dropped when the client did not ask for usage', () => {
  const { s, chunks } = sanitizer({ clientWantsUsage: false });
  const out = s.push(dataLine({ id: 'x', choices: [], usage: { prompt_tokens: 3, completion_tokens: 2 } }));
  assert.equal(out, '');
  assert.equal(chunks.length, 1, 'billing still sees the usage chunk');
});

test('sse-sanitize Case B: usage is stripped from a content chunk but onChunk sees it first', () => {
  const { s, chunks } = sanitizer({ clientWantsUsage: false });
  const out = s.push(dataLine({ choices: [{ delta: { content: 'hi' } }], usage: { prompt_tokens: 3, completion_tokens: 2 } }));
  assert.equal(out, `data: ${JSON.stringify({ choices: [{ delta: { content: 'hi' } }], model: PUBLIC })}\n`);
  assert.deepEqual(chunks[0]!.usage, { prompt_tokens: 3, completion_tokens: 2 });
});

test('sse-sanitize: "usage": null is removed from every forwarded chunk', () => {
  const { s } = sanitizer({ clientWantsUsage: false });
  const out = s.push(dataLine({ choices: [{ delta: { content: 'a' } }], usage: null }));
  assert.equal(out.includes('"usage"'), false);
});

test('sse-sanitize: usage chunk is forwarded with the model rewritten when the client asked', () => {
  const { s } = sanitizer({ clientWantsUsage: true });
  const out = s.push(dataLine({ model: 'upstream/internal', choices: [], usage: { prompt_tokens: 3, completion_tokens: 2 } }));
  assert.equal(
    out,
    `data: ${JSON.stringify({ model: PUBLIC, choices: [], usage: { prompt_tokens: 3, completion_tokens: 2 } })}\n`,
  );
});

test('sse-sanitize: onChunk is not called for error or non-JSON lines', () => {
  const chunks: unknown[] = [];
  const s = createSseSanitizer({
    publicModel: PUBLIC,
    clientWantsUsage: false,
    onChunk: (chunk) => chunks.push(chunk),
  });
  s.push(`data: ${JSON.stringify({ error: { message: 'x' } })}\n`);
  s.push('data: not-json\n');
  assert.equal(chunks.length, 0);
});

test('sse-sanitize: one trailing \\r is stripped (CRLF upstreams)', () => {
  const { s } = sanitizer();
  assert.equal(s.push('data: [DONE]\r\n'), 'data: [DONE]\n');
});

test('sse-sanitize: a line split across pushes is buffered and emitted once complete', () => {
  const { s } = sanitizer();
  const full = dataLine({ choices: [{ delta: { content: 'split' } }] });
  const cut = 12;
  assert.equal(s.push(full.slice(0, cut)), '');
  assert.equal(s.push(full.slice(cut)), `data: ${JSON.stringify({ choices: [{ delta: { content: 'split' } }], model: PUBLIC })}\n`);
});

test('sse-sanitize: flush emits a final line without a trailing newline', () => {
  const { s } = sanitizer();
  const full = dataLine({ choices: [{ delta: { content: 'tail' } }] }).trimEnd();
  assert.equal(s.push(full), '');
  assert.equal(s.flush(), `data: ${JSON.stringify({ choices: [{ delta: { content: 'tail' } }], model: PUBLIC })}\n`);
  assert.equal(s.flush(), '');
});

test('sse-sanitize: an oversized partial line is dropped and reported', () => {
  const { s, drops } = sanitizer();
  assert.equal(s.push('x'.repeat(1_000_001)), '');
  assert.deepEqual(drops.map((d) => d.reason), ['overflow']);
  assert.equal(s.flush(), '');
});

test('sanitizeCompletionBody: rewrites model, drops provider fields, keeps usage', () => {
  const input = {
    id: 'x',
    object: 'chat.completion',
    model: 'upstream/internal',
    provider: 'deepseek',
    system_fingerprint: 'fp_1',
    choices: [{ message: { role: 'assistant', content: 'hi' } }],
    usage: { prompt_tokens: 3, completion_tokens: 2 },
  };
  const result = sanitizeCompletionBody(JSON.stringify(input), PUBLIC);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.json.model, PUBLIC);
  assert.equal('provider' in result.json, false);
  assert.equal('system_fingerprint' in result.json, false);
  assert.deepEqual(result.json.usage, { prompt_tokens: 3, completion_tokens: 2 });
  assert.deepEqual(JSON.parse(result.body), result.json);
});

test('sanitizeCompletionBody: rejects non-JSON and never echoes the text', () => {
  const result = sanitizeCompletionBody('<html>provider-secret</html>', PUBLIC);
  assert.deepEqual(result, { ok: false, reason: 'non_json' });
});

test('sanitizeCompletionBody: rejects arrays and null', () => {
  assert.deepEqual(sanitizeCompletionBody('[]', PUBLIC), { ok: false, reason: 'non_json' });
  assert.deepEqual(sanitizeCompletionBody('null', PUBLIC), { ok: false, reason: 'non_json' });
});

test('sanitizeCompletionBody: rejects an error payload', () => {
  const result = sanitizeCompletionBody(JSON.stringify({ error: { message: 'upstream secret' } }), PUBLIC);
  assert.deepEqual(result, { ok: false, reason: 'error_payload' });
});
