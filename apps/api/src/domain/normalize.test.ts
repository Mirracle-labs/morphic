import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeMessages,
  repairToolPairs,
  normalizeRequest,
  type ChatMessageLike,
  type NormalizedToolCall,
} from './normalize';

const assistantCall = (id: string, name = 'calc', args = '{"a":1}') => ({
  id,
  type: 'function',
  function: { name, arguments: args },
});

test('normalizeMessages: null or missing content becomes an empty string', () => {
  const [nullContent, missingContent] = normalizeMessages([
    { role: 'assistant', content: null },
    { role: 'user' },
  ]);
  assert.equal(nullContent!.content, '');
  assert.equal(missingContent!.content, '');
});

test('normalizeMessages: text-only arrays collapse to a single string', () => {
  const [msg] = normalizeMessages([
    { role: 'user', content: [{ type: 'text', text: 'hello' }, { type: 'text', text: 'world' }] },
  ]);
  assert.equal(msg!.content, 'hello\nworld');
});

test('normalizeMessages: multimodal arrays are kept as arrays', () => {
  const parts = [
    { type: 'text', text: 'what is this?' },
    { type: 'image_url', image_url: { url: 'https://example.test/a.png' } },
  ];
  const [msg] = normalizeMessages([{ role: 'user', content: parts }]);
  assert.deepEqual(msg!.content, parts);
});

test('normalizeMessages: empty content array becomes an empty string', () => {
  const [msg] = normalizeMessages([{ role: 'user', content: [] }]);
  assert.equal(msg!.content, '');
});

test('normalizeMessages: developer role becomes system and unknown fields survive', () => {
  const [msg] = normalizeMessages([
    { role: 'developer', content: 'be terse', cache_control: { type: 'ephemeral' } },
  ]);
  assert.equal(msg!.role, 'system');
  assert.equal(msg!.content, 'be terse');
  assert.deepEqual(msg!.cache_control, { type: 'ephemeral' });
});

test('normalizeMessages: empty tool_calls are removed', () => {
  const [msg] = normalizeMessages([{ role: 'assistant', content: null, tool_calls: [] }]);
  assert.equal('tool_calls' in msg!, false);
});

test('normalizeMessages: tool calls get type=function, an id and string arguments', () => {
  const [msg] = normalizeMessages([
    {
      role: 'assistant',
      tool_calls: [
        { function: { name: 'calc', arguments: '' } },
        { id: 'call_ok', function: { name: 'calc', arguments: { a: 2 } } },
        { id: 'call_null', type: 'weird', function: { name: 'calc', arguments: null } },
      ],
    },
  ]);
  const calls = msg!.tool_calls as NormalizedToolCall[];
  assert.equal(calls.length, 3);
  assert.equal(calls[0]!.type, 'function');
  assert.match(calls[0]!.id, /^call_0_0$/);
  assert.equal(calls[0]!.function.arguments, '{}');
  assert.equal(calls[1]!.function.arguments, '{"a":2}');
  assert.equal(calls[2]!.type, 'function');
  assert.equal(calls[2]!.function.arguments, '{}');
});

test('normalizeMessages: non-array tool_calls are dropped', () => {
  const [msg] = normalizeMessages([{ role: 'assistant', tool_calls: 'nope' }]);
  assert.equal('tool_calls' in msg!, false);
});

test('repairToolPairs: matching results stay in place', () => {
  const input: ChatMessageLike[] = [
    { role: 'assistant', content: null, tool_calls: [assistantCall('a')] },
    { role: 'tool', tool_call_id: 'a', content: '1' },
  ];
  const out = repairToolPairs(input);
  assert.equal(out.length, 2);
  assert.equal(out[1]!.content, '1');
  assert.equal(out[1]!.tool_call_id, 'a');
});

test('repairToolPairs: missing result gets a synthetic tool message', () => {
  const out = repairToolPairs([
    { role: 'assistant', tool_calls: [assistantCall('a'), assistantCall('b')] },
    { role: 'tool', tool_call_id: 'a', content: '1' },
  ]);
  assert.equal(out.length, 3);
  assert.equal(out[2]!.role, 'tool');
  assert.equal(out[2]!.tool_call_id, 'b');
  assert.equal(out[2]!.content, 'error: tool result missing');
});

test('repairToolPairs: orphan tool messages are dropped', () => {
  const out = repairToolPairs([
    { role: 'user', content: 'hi' },
    { role: 'tool', tool_call_id: 'gone', content: '1' },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0]!.role, 'user');
});

test('repairToolPairs: results are reordered to match tool_calls order', () => {
  const out = repairToolPairs([
    { role: 'assistant', tool_calls: [assistantCall('a'), assistantCall('b')] },
    { role: 'tool', tool_call_id: 'b', content: 'B' },
    { role: 'tool', tool_call_id: 'a', content: 'A' },
  ]);
  assert.deepEqual(
    out.slice(1).map((m) => [m.tool_call_id, m.content]),
    [
      ['a', 'A'],
      ['b', 'B'],
    ],
  );
});

test('repairToolPairs: duplicate ids are suffixed and results follow them', () => {
  const out = repairToolPairs([
    { role: 'assistant', tool_calls: [assistantCall('dup'), assistantCall('dup')] },
    { role: 'tool', tool_call_id: 'dup', content: 'first' },
    { role: 'tool', tool_call_id: 'dup', content: 'second' },
  ]);
  const calls = out[0]!.tool_calls as Array<{ id: string }>;
  assert.deepEqual(calls.map((c) => c.id), ['dup', 'dup_2']);
  assert.deepEqual(
    out.slice(1).map((m) => [m.tool_call_id, m.content]),
    [
      ['dup', 'first'],
      ['dup_2', 'second'],
    ],
  );
});

test('repairToolPairs: extra results for one call are dropped', () => {
  const out = repairToolPairs([
    { role: 'assistant', tool_calls: [assistantCall('a')] },
    { role: 'tool', tool_call_id: 'a', content: 'first' },
    { role: 'tool', tool_call_id: 'a', content: 'second' },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[1]!.content, 'first');
});

test('repairToolPairs: a result separated by another message becomes a synthetic pair', () => {
  const out = repairToolPairs([
    { role: 'assistant', tool_calls: [assistantCall('a')] },
    { role: 'user', content: 'wait' },
    { role: 'tool', tool_call_id: 'a', content: '1' },
  ]);
  assert.equal(out.length, 3);
  assert.equal(out[1]!.role, 'tool');
  assert.equal(out[1]!.content, 'error: tool result missing');
  assert.equal(out[2]!.role, 'user');
});

test('repairToolPairs: does not mutate the input', () => {
  const input: ChatMessageLike[] = [
    { role: 'assistant', tool_calls: [assistantCall('dup'), assistantCall('dup')] },
    { role: 'tool', tool_call_id: 'dup', content: 'first' },
  ];
  const snapshot = JSON.parse(JSON.stringify(input));
  repairToolPairs(input);
  assert.deepEqual(input, snapshot);
});

test('normalizeRequest: normalizes messages and preserves top-level fields', () => {
  const body = {
    model: 'deepseek-v4',
    stream: true,
    temperature: 0.2,
    messages: [
      { role: 'developer', content: 'be terse' },
      { role: 'assistant', content: null, tool_calls: [assistantCall('a')] },
      { role: 'tool', tool_call_id: 'a', content: '1' },
    ],
  };
  const out = normalizeRequest(body);
  assert.equal(out.model, 'deepseek-v4');
  assert.equal(out.stream, true);
  assert.equal(out.temperature, 0.2);
  const messages = out.messages as ChatMessageLike[];
  assert.equal(messages[0]!.role, 'system');
  assert.equal(messages[1]!.content, '');
});

test('normalizeRequest: bodies without a messages array pass through unchanged', () => {
  const body = { model: 'x' };
  assert.equal(normalizeRequest(body), body);
});
