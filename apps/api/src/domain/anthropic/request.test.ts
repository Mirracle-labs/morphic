import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AnthropicMessagesRequest } from '@morphic/shared/anthropic';
import { translateAnthropicRequest, sanitizeToolId } from './request';

const base = (overrides: Partial<AnthropicMessagesRequest> = {}): AnthropicMessagesRequest => ({
  model: 'claude-test',
  max_tokens: 100,
  messages: [{ role: 'user', content: 'hi' }],
  ...overrides,
});

type OpenAiMessage = {
  role: string;
  content?: unknown;
  tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
};

test('request: system string becomes one system message', () => {
  const body = translateAnthropicRequest(base({ system: 'be terse' }));
  const messages = body.messages as OpenAiMessage[];
  assert.deepEqual(messages[0], { role: 'system', content: 'be terse' });
});

test('request: system blocks are joined and cache_control is dropped', () => {
  const body = translateAnthropicRequest(
    base({
      system: [
        { type: 'text', text: 'one', cache_control: { type: 'ephemeral' } },
        { type: 'text', text: 'two' },
      ],
    }),
  );
  const messages = body.messages as OpenAiMessage[];
  assert.deepEqual(messages[0], { role: 'system', content: 'one\ntwo' });
  assert.equal(JSON.stringify(body).includes('cache_control'), false);
});

test('request: base64 and url images become image_url parts', () => {
  const body = translateAnthropicRequest(
    base({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'look' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } },
            { type: 'image', source: { type: 'url', url: 'https://example.test/a.png' } },
          ],
        },
      ],
    }),
  );
  const messages = body.messages as OpenAiMessage[];
  assert.deepEqual(messages[0]!.content, [
    { type: 'text', text: 'look' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
    { type: 'image_url', image_url: { url: 'https://example.test/a.png' } },
  ]);
});

test('request: tool_use and tool_result round-trip with normalized ids', () => {
  const body = translateAnthropicRequest(
    base({
      messages: [
        { role: 'user', content: 'add' },
        {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'call.1/a', name: 'calc', input: { x: 1 } }],
        },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'call.1/a', content: '2', is_error: true },
            { type: 'text', text: 'thanks' },
          ],
        },
      ],
    }),
  );
  const messages = body.messages as OpenAiMessage[];
  assert.deepEqual(messages.map((m) => m.role), ['user', 'assistant', 'tool', 'user']);
  assert.equal(messages[1]!.tool_calls![0]!.id, 'call_1_a');
  assert.equal(messages[1]!.tool_calls![0]!.function.arguments, '{"x":1}');
  assert.equal(messages[2]!.tool_call_id, 'call_1_a');
  assert.equal(messages[2]!.content, '[tool error] 2');
});

test('request: tool_result array content is joined', () => {
  const body = translateAnthropicRequest(
    base({
      messages: [
        { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'f', input: {} }] },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'c1',
              content: [
                { type: 'text', text: 'a' },
                { type: 'image', source: { type: 'url', url: 'x' } },
                { type: 'text', text: 'b' },
              ],
            },
          ],
        },
      ],
    }),
  );
  const messages = body.messages as OpenAiMessage[];
  assert.equal(messages[1]!.content, 'a\n[image]\nb');
});

test('request: tool_choice maps auto/any/tool/none', () => {
  const tools = [{ name: 'calc', input_schema: { type: 'object', properties: {} } }];
  const expected: Array<[string, unknown]> = [
    ['auto', 'auto'],
    ['any', 'required'],
    ['none', 'none'],
    ['tool', { type: 'function', function: { name: 'calc' } }],
  ];
  for (const [type, value] of expected) {
    const body = translateAnthropicRequest(
      base({ tools, tool_choice: { type: type as 'auto' | 'any' | 'none' | 'tool', name: 'calc' } }),
    );
    assert.deepEqual(body.tool_choice, value, type);
  }
});

test('request: tools are translated to function tools', () => {
  const body = translateAnthropicRequest(
    base({
      tools: [{ name: 'calc', description: 'add', input_schema: { type: 'object', properties: {} } }],
    }),
  );
  assert.deepEqual(body.tools, [
    {
      type: 'function',
      function: {
        name: 'calc',
        description: 'add',
        parameters: { type: 'object', properties: {} },
      },
    },
  ]);
});

test('request: stop_sequences and metadata.user_id map to stop/user; top_k and thinking drop', () => {
  const body = translateAnthropicRequest(
    base({
      stop_sequences: ['STOP'],
      metadata: { user_id: 'u1' },
      top_k: 5,
      thinking: { type: 'enabled', budget_tokens: 100 },
      temperature: 0.4,
      top_p: 0.9,
    }),
  );
  assert.deepEqual(body.stop, ['STOP']);
  assert.equal(body.user, 'u1');
  assert.equal(body.temperature, 0.4);
  assert.equal(body.top_p, 0.9);
  assert.equal('top_k' in body, false);
  assert.equal('thinking' in body, false);
});

test('request: consecutive user turns are merged', () => {
  const body = translateAnthropicRequest(
    base({
      messages: [
        { role: 'user', content: 'a' },
        { role: 'user', content: 'b' },
      ],
    }),
  );
  const messages = body.messages as OpenAiMessage[];
  assert.equal(messages.length, 1);
  assert.equal(messages[0]!.content, 'a\nb');
});

test('request: empty text blocks are dropped', () => {
  const body = translateAnthropicRequest(
    base({
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: '   ' },
            { type: 'text', text: 'ok' },
          ],
        },
      ],
    }),
  );
  const messages = body.messages as OpenAiMessage[];
  assert.equal(messages[0]!.content, 'ok');
});

test('request: max_tokens is clamped to the model context cap', () => {
  const body = translateAnthropicRequest(base({ max_tokens: 5000 }), { maxTokens: 128 });
  assert.equal(body.max_tokens, 128);
});

test('request: assistant tool_calls without results get a synthetic result', () => {
  const body = translateAnthropicRequest(
    base({
      messages: [
        { role: 'user', content: 'go' },
        { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'f', input: {} }] },
      ],
    }),
  );
  const messages = body.messages as OpenAiMessage[];
  assert.deepEqual(messages.map((m) => m.role), ['user', 'assistant', 'tool']);
  assert.equal(messages[2]!.content, 'error: tool result missing');
});

test('sanitizeToolId: keeps safe ids, replaces the rest, and never returns empty', () => {
  assert.equal(sanitizeToolId('call_1-A', 'fallback'), 'call_1-A');
  assert.equal(sanitizeToolId('a.b/c', 'fallback'), 'a_b_c');
  assert.equal(sanitizeToolId('', 'fallback'), 'fallback');
  assert.equal(sanitizeToolId(undefined, 'fallback'), 'fallback');
});
