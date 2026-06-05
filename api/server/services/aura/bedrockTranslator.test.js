'use strict';

const { translateModelId, translateRequestBody } = require('./bedrockTranslator');

describe('translateModelId', () => {
  it('prefixes model with anthropic.', () => {
    expect(translateModelId('claude-opus-4-7')).toBe('anthropic.claude-opus-4-7');
  });

  it('is idempotent when already prefixed', () => {
    expect(translateModelId('anthropic.claude-opus-4-7')).toBe('anthropic.claude-opus-4-7');
  });

  it('throws when model is missing', () => {
    expect(() => translateModelId(undefined)).toThrow('model is required');
    expect(() => translateModelId('')).toThrow('model is required');
    expect(() => translateModelId(null)).toThrow('model is required');
  });
});

describe('translateRequestBody', () => {
  const baseBody = {
    model: 'claude-sonnet-4-6',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 100,
  };

  it('always injects anthropic_version: bedrock-2023-05-31', () => {
    const { body } = translateRequestBody(baseBody);
    expect(body.anthropic_version).toBe('bedrock-2023-05-31');
  });

  it('strips model from body and returns it as modelId', () => {
    const { body, modelId } = translateRequestBody(baseBody);
    expect(body.model).toBeUndefined();
    expect(modelId).toBe('anthropic.claude-sonnet-4-6');
  });

  it('passes messages through unchanged', () => {
    const { body } = translateRequestBody(baseBody);
    expect(body.messages).toEqual(baseBody.messages);
  });

  it('passes system through unchanged', () => {
    const input = { ...baseBody, system: 'You are helpful.' };
    const { body } = translateRequestBody(input);
    expect(body.system).toBe('You are helpful.');
  });

  it('passes max_tokens through unchanged', () => {
    const { body } = translateRequestBody(baseBody);
    expect(body.max_tokens).toBe(100);
  });

  it('passes temperature through unchanged', () => {
    const input = { ...baseBody, temperature: 0.7 };
    const { body } = translateRequestBody(input);
    expect(body.temperature).toBe(0.7);
  });

  it('passes top_p through unchanged', () => {
    const input = { ...baseBody, top_p: 0.9 };
    const { body } = translateRequestBody(input);
    expect(body.top_p).toBe(0.9);
  });

  it('passes top_k through unchanged', () => {
    const input = { ...baseBody, top_k: 40 };
    const { body } = translateRequestBody(input);
    expect(body.top_k).toBe(40);
  });

  it('passes stop_sequences through unchanged', () => {
    const input = { ...baseBody, stop_sequences: ['END'] };
    const { body } = translateRequestBody(input);
    expect(body.stop_sequences).toEqual(['END']);
  });

  it('drops stream (controller branches on it before translating; Bedrock InvokeModel body has no stream field)', () => {
    const input = { ...baseBody, stream: true };
    const { body } = translateRequestBody(input);
    expect(body.stream).toBeUndefined();
  });

  it('passes tools through unchanged', () => {
    const tools = [{ name: 'calculator', description: 'does math', input_schema: { type: 'object', properties: {} } }];
    const input = { ...baseBody, tools };
    const { body } = translateRequestBody(input);
    expect(body.tools).toEqual(tools);
  });

  it('drops metadata', () => {
    const input = { ...baseBody, metadata: { user_id: 'u1' } };
    const { body } = translateRequestBody(input);
    expect(body.metadata).toBeUndefined();
  });

  it('drops cache_control', () => {
    const input = { ...baseBody, cache_control: { type: 'ephemeral' } };
    const { body } = translateRequestBody(input);
    expect(body.cache_control).toBeUndefined();
  });

  it('drops service_tier', () => {
    const input = { ...baseBody, service_tier: 'auto' };
    const { body } = translateRequestBody(input);
    expect(body.service_tier).toBeUndefined();
  });

  it('drops output_config', () => {
    const input = { ...baseBody, output_config: { format: 'json' } };
    const { body } = translateRequestBody(input);
    expect(body.output_config).toBeUndefined();
  });

  it('drops container', () => {
    const input = { ...baseBody, container: { id: 'c1' } };
    const { body } = translateRequestBody(input);
    expect(body.container).toBeUndefined();
  });

  it('drops inference_geo', () => {
    const input = { ...baseBody, inference_geo: { region: 'us' } };
    const { body } = translateRequestBody(input);
    expect(body.inference_geo).toBeUndefined();
  });

  it('passes known Bedrock betas through', () => {
    const { body } = translateRequestBody(baseBody, 'interleaved-thinking-2025-05-14,extended-output-2025-06-30');
    expect(body.anthropic_beta).toEqual(['interleaved-thinking-2025-05-14', 'extended-output-2025-06-30']);
  });

  it('filters out client-tool betas that Bedrock does not recognise', () => {
    // Claude Code CLI injects claude-code-2025-03-07 which Bedrock rejects with ValidationException
    const { body } = translateRequestBody(baseBody, 'claude-code-2025-03-07');
    expect(body.anthropic_beta).toBeUndefined();
  });

  it('keeps only Bedrock-valid betas when header contains a mix', () => {
    const header = 'claude-code-2025-03-07,interleaved-thinking-2025-05-14,unknown-flag';
    const { body } = translateRequestBody(baseBody, header);
    expect(body.anthropic_beta).toEqual(['interleaved-thinking-2025-05-14']);
  });

  it('omits anthropic_beta when header is absent', () => {
    const { body } = translateRequestBody(baseBody);
    expect(body.anthropic_beta).toBeUndefined();
  });

  it('omits anthropic_beta when header is empty string', () => {
    const { body } = translateRequestBody(baseBody, '');
    expect(body.anthropic_beta).toBeUndefined();
  });
});
