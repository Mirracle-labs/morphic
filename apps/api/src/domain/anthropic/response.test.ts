import { test } from 'node:test';
import assert from 'node:assert/strict';
import { translateAnthropicResponse, mapStopReason } from './response';

const upstream = (overrides: Record<string, unknown> = {}) => ({
  id: 'chatcmpl-1',
  choices: [
    {
      message: { role: 'assistant', content: 'hello' },
      finish_reason: 'stop',
    },
  ],
  usage: { prompt_tokens: 3, completion_tokens: 2 },
  ...overrides,
});

test('response: text completion becomes an Anthropic message', () => {
  const message = translateAnthropicResponse(upstream(), { model: 'claude-test' });
  assert.match(message.id, /^msg_/);
  assert.equal(message.type, 'message');
  assert.equal(message.role, 'assistant');
  assert.equal(message.model, 'claude-test');
  assert.deepEqual(message.content, [{ type: 'text', text: 'hello' }]);
  assert.equal(message.stop_reason, 'end_turn');
  assert.equal(message.stop_sequence, null);
  assert.deepEqual(message.usage, { input_tokens: 3, output_tokens: 2 });
});

test('response: tool calls become tool_use blocks with parsed input', () => {
  const message = translateAnthropicResponse(
    upstream({
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'calc', arguments: '{"expr":"2+2"}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    }),
    { model: 'claude-test' },
  );
  assert.deepEqual(message.content, [
    { type: 'tool_use', id: 'call_1', name: 'calc', input: { expr: '2+2' } },
  ]);
  assert.equal(message.stop_reason, 'tool_use');
});

test('response: invalid tool arguments are repaired to an empty object', () => {
  const message = translateAnthropicResponse(
    upstream({
      choices: [
        {
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{ id: 'c1', type: 'function', function: { name: 'f', arguments: '{not json' } }],
          },
          finish_reason: 'tool_calls',
        },
      ],
    }),
    { model: 'claude-test' },
  );
  assert.deepEqual(message.content, [{ type: 'tool_use', id: 'c1', name: 'f', input: {} }]);
});

test('response: stop reasons map to Anthropic values', () => {
  assert.equal(mapStopReason('length', false), 'max_tokens');
  assert.equal(mapStopReason('stop', false), 'end_turn');
  assert.equal(mapStopReason('tool_calls', false), 'tool_use');
  assert.equal(mapStopReason('anything-else', true), 'tool_use');
  assert.equal(mapStopReason(undefined, false), 'end_turn');
});

test('response: array content parts are joined', () => {
  const message = translateAnthropicResponse(
    upstream({
      choices: [
        {
          message: {
            role: 'assistant',
            content: [
              { type: 'text', text: 'a' },
              { type: 'text', text: 'b' },
            ],
          },
          finish_reason: 'stop',
        },
      ],
    }),
    { model: 'claude-test' },
  );
  assert.deepEqual(message.content, [{ type: 'text', text: 'ab' }]);
});

test('response: a body without choices throws', () => {
  assert.throws(() => translateAnthropicResponse({ choices: [] }, { model: 'x' }));
  assert.throws(() => translateAnthropicResponse({}, { model: 'x' }));
});
