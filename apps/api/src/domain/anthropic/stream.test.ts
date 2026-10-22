import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAnthropicStreamTranslator } from './stream';

interface ParsedEvent {
  event: string;
  data: Record<string, unknown>;
}

function parseEvents(text: string): ParsedEvent[] {
  const events: ParsedEvent[] = [];
  for (const block of text.split('\n\n')) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    const lines = trimmed.split('\n');
    const eventLine = lines.find((line) => line.startsWith('event: '));
    const dataLine = lines.find((line) => line.startsWith('data: '));
    if (!eventLine || !dataLine) continue;
    events.push({
      event: eventLine.slice('event: '.length),
      data: JSON.parse(dataLine.slice('data: '.length)) as Record<string, unknown>,
    });
  }
  return events;
}

const sse = (payload: unknown) => `data: ${JSON.stringify(payload)}\n\n`;

function run(chunks: string[], estimated = 0) {
  const translator = createAnthropicStreamTranslator({ model: 'claude-test', inputTokens: 3 });
  let out = translator.start();
  for (const chunk of chunks) out += translator.push(chunk);
  out += translator.flush();
  out += translator.finish(estimated);
  return { out, events: parseEvents(out) };
}

test('stream: text emits the Anthropic event order and no [DONE]', () => {
  const { events, out } = run([
    sse({ choices: [{ delta: { content: 'Hel' } }] }),
    sse({ choices: [{ delta: { content: 'lo' }, finish_reason: 'stop' }] }),
    sse({ choices: [], usage: { prompt_tokens: 3, completion_tokens: 2 } }),
    'data: [DONE]\n\n',
  ]);
  assert.deepEqual(
    events.map((e) => e.event),
    [
      'message_start',
      'content_block_start',
      'content_block_delta',
      'content_block_delta',
      'content_block_stop',
      'message_delta',
      'message_stop',
    ],
  );
  assert.equal(out.includes('[DONE]'), false);
  assert.deepEqual(
    events.filter((e) => e.event === 'content_block_delta').map((e) => e.data.delta),
    [
      { type: 'text_delta', text: 'Hel' },
      { type: 'text_delta', text: 'lo' },
    ],
  );
  const delta = events.find((e) => e.event === 'message_delta')!;
  assert.deepEqual(delta.data.delta, { stop_reason: 'end_turn', stop_sequence: null });
  assert.deepEqual(delta.data.usage, { output_tokens: 2 });
});

test('stream: tool calls are buffered and emitted as tool_use blocks', () => {
  const { events, out } = run([
    sse({
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, id: 'call_1', function: { name: 'calc', arguments: '{"x":' } },
            ],
          },
        },
      ],
    }),
    sse({
      choices: [
        {
          delta: { tool_calls: [{ index: 0, function: { arguments: '1}' } }] },
          finish_reason: 'tool_calls',
        },
      ],
    }),
  ]);
  assert.equal(out.includes('tool_use'), true);
  const start = events.find((e) => e.event === 'content_block_start')!;
  assert.deepEqual(start.data.content_block, {
    type: 'tool_use',
    id: 'call_1',
    name: 'calc',
    input: {},
  });
  const delta = events.find((e) => e.event === 'content_block_delta')!;
  assert.deepEqual(delta.data.delta, { type: 'input_json_delta', partial_json: '{"x":1}' });
  const messageDelta = events.find((e) => e.event === 'message_delta')!;
  assert.deepEqual(messageDelta.data.delta, { stop_reason: 'tool_use', stop_sequence: null });
});

test('stream: multiple tool indexes become separate blocks in order', () => {
  const { events } = run([
    sse({
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 1, id: 'b', function: { name: 'two', arguments: '{}' } },
              { index: 0, id: 'a', function: { name: 'one', arguments: '{}' } },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    }),
  ]);
  const blocks = events
    .filter((e) => e.event === 'content_block_start')
    .map((e) => (e.data.content_block as { id: string }).id);
  assert.deepEqual(blocks, ['a', 'b']);
});

test('stream: a line split across chunks is parsed once', () => {
  const full = `data: ${JSON.stringify({ choices: [{ delta: { content: 'hi' } }] })}\n\n`;
  const split = Math.floor(full.length / 2);
  const translator = createAnthropicStreamTranslator({ model: 'claude-test', inputTokens: 3 });
  let out = translator.start();
  out += translator.push(full.slice(0, split));
  assert.equal(out.includes('text_delta'), false);
  out += translator.push(full.slice(split));
  out += translator.finish(1);
  assert.equal(out.includes('text_delta'), true);
});

test('stream: an upstream error payload marks the stream failed', () => {
  const translator = createAnthropicStreamTranslator({ model: 'claude-test', inputTokens: 3 });
  translator.start();
  translator.push(sse({ error: { message: 'boom-secret' } }));
  assert.equal(translator.state.failed, true);
  const failed = translator.fail();
  assert.match(failed, /^event: error\n/);
  assert.equal(failed.includes('boom-secret'), false);
  assert.equal(failed.includes('api_error'), true);
});

test('stream: an empty upstream still produces a valid message', () => {
  const { events } = run([], 0);
  assert.deepEqual(
    events.map((e) => e.event),
    [
      'message_start',
      'content_block_start',
      'content_block_stop',
      'message_delta',
      'message_stop',
    ],
  );
});

test('stream: estimated output tokens are used when usage is missing', () => {
  const { events } = run([sse({ choices: [{ delta: { content: 'abcd' } }] })], 7);
  const delta = events.find((e) => e.event === 'message_delta')!;
  assert.deepEqual(delta.data.usage, { output_tokens: 7 });
});
