/**
 * Protocol Phase 4: capability detection and D9 helpers (pure unit tests).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectAnthropicCapabilities,
  detectOpenAiCapabilities,
  legacyCapabilities,
  poolParityIssues,
  supportsRequiredCapabilities,
  supportsRequiredToolChoice,
} from './provider-capabilities';

test('Phase4 caps: OpenAI tools are detected only for a non-empty tools array', () => {
  assert.deepEqual(detectOpenAiCapabilities({ messages: [] }), []);
  assert.deepEqual(detectOpenAiCapabilities({ messages: [], tools: [] }), []);
  assert.deepEqual(
    detectOpenAiCapabilities({ messages: [], tools: [{ type: 'function', function: { name: 'f' } }] }),
    ['tools'],
  );
});

test('Phase4 caps: OpenAI vision is detected from image_url parts in any message', () => {
  const withImage = {
    messages: [
      { role: 'system', content: 'be helpful' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'what is this?' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
        ],
      },
    ],
  };
  assert.deepEqual(detectOpenAiCapabilities(withImage), ['vision']);

  // A string body, a text-only array and a tool message are not vision.
  assert.deepEqual(
    detectOpenAiCapabilities({ messages: [{ role: 'user', content: 'hi' }] }),
    [],
  );
  assert.deepEqual(
    detectOpenAiCapabilities({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    }),
    [],
  );
});

test('Phase4 caps: OpenAI tools + vision are returned in a stable order', () => {
  assert.deepEqual(
    detectOpenAiCapabilities({
      tools: [{ type: 'function', function: { name: 'f' } }],
      messages: [
        {
          role: 'user',
          content: [{ type: 'image_url', image_url: { url: 'https://example.test/a.png' } }],
        },
      ],
    }),
    ['tools', 'vision'],
  );
});

test('Phase4 caps: Anthropic tools and image blocks are detected', () => {
  assert.deepEqual(detectAnthropicCapabilities({ messages: [] }), []);
  assert.deepEqual(detectAnthropicCapabilities({ messages: [], tools: [] }), []);
  assert.deepEqual(
    detectAnthropicCapabilities({
      tools: [{ name: 'calc', input_schema: { type: 'object' } }],
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'look' },
            { type: 'image', source: { type: 'url', url: 'https://example.test/a.png' } },
          ],
        },
      ],
    }),
    ['tools', 'vision'],
  );

  // Images inside a tool_result are translated to text, so they are not vision.
  assert.deepEqual(
    detectAnthropicCapabilities({
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'c1',
              content: [{ type: 'image', source: { type: 'url', url: 'https://example.test/a.png' } }],
            },
          ],
        },
      ],
    }),
    [],
  );
});

test('Phase4 caps: legacy claims are permissive unless explicitly denied', () => {
  assert.deepEqual(legacyCapabilities(['coding', 'reasoning']), {
    supportsTools: true,
    supportsVision: true,
    supportsReasoning: true,
  });
  assert.deepEqual(legacyCapabilities([]), {
    supportsTools: true,
    supportsVision: true,
    supportsReasoning: false,
  });
  assert.deepEqual(legacyCapabilities(['no-tools', 'no-vision']), {
    supportsTools: false,
    supportsVision: false,
    supportsReasoning: false,
  });
});

test('Phase4 caps: required capabilities must all be supported by one entry', () => {
  assert.equal(
    supportsRequiredCapabilities({ supportsTools: true, supportsVision: false }, ['tools']),
    true,
  );
  assert.equal(
    supportsRequiredCapabilities({ supportsTools: true, supportsVision: false }, ['vision']),
    false,
  );
  assert.equal(
    supportsRequiredCapabilities({ supportsTools: true, supportsVision: false }, ['tools', 'vision']),
    false,
  );
  assert.equal(supportsRequiredCapabilities({ supportsTools: false, supportsVision: false }, []), true);
});

test('Phase4 caps: reasoning-echo entries do not support tool_choice required', () => {
  assert.equal(supportsRequiredToolChoice({ reasoningEchoRequired: true }), false);
  assert.equal(supportsRequiredToolChoice({ reasoningEchoRequired: false }), true);
});

test('Phase4 D9: pool parity issues cover context, tools and vision', () => {
  const model = { contextLength: 32768, capabilities: ['coding', 'reasoning', 'vision'] };

  assert.deepEqual(
    poolParityIssues(
      { contextLength: 65536, supportsTools: true, supportsVision: true },
      model,
    ),
    [],
  );
  assert.deepEqual(
    poolParityIssues(
      { contextLength: 8192, supportsTools: false, supportsVision: false },
      model,
    ),
    ['context_length', 'tools', 'vision'],
  );
  // NULL context means "not declared", not "zero".
  assert.deepEqual(
    poolParityIssues({ contextLength: null, supportsTools: true, supportsVision: true }, model),
    [],
  );
  // A model that explicitly denies tools has no tools parity requirement.
  assert.deepEqual(
    poolParityIssues(
      { contextLength: null, supportsTools: false, supportsVision: true },
      { contextLength: 8192, capabilities: ['no-tools'] },
    ),
    [],
  );
});
