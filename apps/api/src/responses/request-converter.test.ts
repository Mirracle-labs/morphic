import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseResponsesRequest } from './validation';
import { toChatRequest } from './request-converter';
import { GatewayError } from './errors';
import type { InputItem } from './types';

test('1. Simple prompt: {"model":"m","input":"Hi"}', () => {
  const req = parseResponsesRequest({ model: 'm', input: 'Hi' });
  const chat = toChatRequest(req);
  assert.deepEqual(chat, {
    model: 'm',
    messages: [{ role: 'user', content: 'Hi' }],
  });
});

test('2. Instructions and max_output_tokens: {"model":"m","instructions":"Be brief","input":"Hi","max_output_tokens":50}', () => {
  const req = parseResponsesRequest({
    model: 'm',
    instructions: 'Be brief',
    input: 'Hi',
    max_output_tokens: 50,
  });
  const chat = toChatRequest(req);
  assert.deepEqual(chat, {
    model: 'm',
    messages: [
      { role: 'system', content: 'Be brief' },
      { role: 'user', content: 'Hi' },
    ],
    max_tokens: 50,
  });
});

test('3. Streaming: {"model":"m","stream":true,"input":"Hi"}', () => {
  const req = parseResponsesRequest({ model: 'm', stream: true, input: 'Hi' });
  const chat = toChatRequest(req);
  assert.equal(chat.stream, true);
  assert.deepEqual(chat.stream_options, { include_usage: true });
});

test('4. Tools: [{"type":"function","name":"f","parameters":{"type":"object"}}]', () => {
  const req = parseResponsesRequest({
    model: 'm',
    input: 'Hi',
    tools: [{ type: 'function', name: 'f', parameters: { type: 'object' } }],
  });
  const chat = toChatRequest(req);
  assert.deepEqual(chat.tools, [
    { type: 'function', function: { name: 'f', parameters: { type: 'object' } } },
  ]);
});

test('5. Tool choice: tool_choice:{"type":"function","name":"f"}', () => {
  const req = parseResponsesRequest({
    model: 'm',
    input: 'Hi',
    tool_choice: { type: 'function', name: 'f' },
  });
  const chat = toChatRequest(req);
  assert.deepEqual(chat.tool_choice, { type: 'function', function: { name: 'f' } });
});

test('6. Text JSON schema format', () => {
  const schema = { type: 'object', properties: { name: { type: 'string' } } };
  const req = parseResponsesRequest({
    model: 'm',
    input: 'Hi',
    text: { format: { type: 'json_schema', name: 'p', strict: true, schema } },
  });
  const chat = toChatRequest(req);
  assert.deepEqual(chat.response_format, {
    type: 'json_schema',
    json_schema: { name: 'p', strict: true, schema },
  });
});

test('7. Content with input_image and input_text parts', () => {
  const req = parseResponsesRequest({
    model: 'm',
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: 'Analyze this image:' },
          { type: 'input_image', image_url: 'https://x/y.png' },
        ],
      },
    ],
  });
  const chat = toChatRequest(req);
  assert.deepEqual(chat.messages, [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Analyze this image:' },
        { type: 'image_url', image_url: { url: 'https://x/y.png' } },
      ],
    },
  ]);
});

test('Function-call round trip', () => {
  const input: InputItem[] = [
    { role: 'user', content: 'Weather in Jakarta?' },
    { type: 'function_call', call_id: 'call_1', name: 'get_weather', arguments: '{"city":"Jakarta"}' },
    { type: 'function_call', call_id: 'call_2', name: 'get_time', arguments: '{}' },
    { type: 'function_call_output', call_id: 'call_1', output: '{"temp":31}' },
    { type: 'function_call_output', call_id: 'call_2', output: '"10:00"' },
  ];
  const req = parseResponsesRequest({ model: 'm', input });
  const chat = toChatRequest(req);
  assert.deepEqual(chat.messages, [
    { role: 'user', content: 'Weather in Jakarta?' },
    {
      role: 'assistant',
      content: null,
      tool_calls: [
        { id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Jakarta"}' } },
        { id: 'call_2', type: 'function', function: { name: 'get_time', arguments: '{}' } },
      ],
    },
    { role: 'tool', tool_call_id: 'call_1', content: '{"temp":31}' },
    { role: 'tool', tool_call_id: 'call_2', content: '"10:00"' },
  ]);
});

test('Error: unsupported web_search tool throws GatewayError 400 unsupported_capability', () => {
  assert.throws(
    () => parseResponsesRequest({ model: 'm', input: 'x', tools: [{ type: 'web_search' }] }),
    (err: unknown) => err instanceof GatewayError && err.status === 400 && err.code === 'unsupported_capability',
  );
});

test('Error: unsupported previous_response_id throws GatewayError 400 unsupported_capability', () => {
  assert.throws(
    () => parseResponsesRequest({ model: 'm', input: 'x', previous_response_id: 'resp_1' } as Record<string, unknown>),
    (err: unknown) => err instanceof GatewayError && err.status === 400 && err.code === 'unsupported_capability',
  );
});

test('Error: unmatched function_call_output throws GatewayError 400 invalid_request', () => {
  const req = parseResponsesRequest({
    model: 'm',
    input: [{ type: 'function_call_output', call_id: 'zzz', output: '1' }],
  });
  assert.throws(
    () => toChatRequest(req),
    (err: unknown) => err instanceof GatewayError && err.status === 400 && err.code === 'invalid_request',
  );
});

test('Error: input_file in content throws GatewayError 400 unsupported_capability', () => {
  const req = parseResponsesRequest({
    model: 'm',
    input: [{ role: 'user', content: [{ type: 'input_file' }] }],
  });
  assert.throws(
    () => toChatRequest(req),
    (err: unknown) => err instanceof GatewayError && err.status === 400 && err.code === 'unsupported_capability',
  );
});

test('Error: missing model throws GatewayError 400 invalid_request', () => {
  assert.throws(
    () => parseResponsesRequest({ input: 'x' } as Record<string, unknown>),
    (err: unknown) => err instanceof GatewayError && err.status === 400 && err.code === 'invalid_request',
  );
});
