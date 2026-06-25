'use strict';

const { translateModelId, translateRequestBody, getModelNativeFormat, normalizeResponse } = require('./bedrockTranslator');

describe('translateModelId', () => {
  it('builds a regional cross-region inference profile for a bare Anthropic model name', () => {
    expect(translateModelId('claude-opus-4-7')).toBe('us.anthropic.claude-opus-4-7');
  });

  it('wraps an anthropic.-prefixed model in the regional inference profile', () => {
    expect(translateModelId('anthropic.claude-opus-4-7')).toBe('us.anthropic.claude-opus-4-7');
  });

  it('wraps amazon.nova models in the regional inference profile', () => {
    expect(translateModelId('amazon.nova-lite-v1:0')).toBe('us.amazon.nova-lite-v1:0');
    expect(translateModelId('amazon.nova-pro-v1:0')).toBe('us.amazon.nova-pro-v1:0');
  });

  it('wraps deepseek.r1-v1:0 in the regional inference profile (only r1 has a us.* profile)', () => {
    expect(translateModelId('deepseek.r1-v1:0')).toBe('us.deepseek.r1-v1:0');
  });

  it('auto-appends -v1:0 for deepseek.r1 shorthand', () => {
    expect(translateModelId('deepseek.r1')).toBe('us.deepseek.r1-v1:0');
  });

  it('keeps deepseek.v3-v1:0 bare — us.deepseek.v3-v1:0 is invalid on Bedrock', () => {
    expect(translateModelId('deepseek.v3-v1:0')).toBe('deepseek.v3-v1:0');
  });

  it('auto-appends -v1:0 for deepseek.v3 shorthand and keeps it bare', () => {
    expect(translateModelId('deepseek.v3')).toBe('deepseek.v3-v1:0');
  });

  it('wraps meta models in the regional inference profile', () => {
    expect(translateModelId('meta.llama3-3-70b-instruct-v1:0')).toBe(
      'us.meta.llama3-3-70b-instruct-v1:0',
    );
  });

  it('auto-appends -v1:0 for meta model shorthands', () => {
    expect(translateModelId('meta.llama4-maverick-17b-instruct')).toBe(
      'us.meta.llama4-maverick-17b-instruct-v1:0',
    );
    expect(translateModelId('meta.llama4-scout-17b-instruct')).toBe(
      'us.meta.llama4-scout-17b-instruct-v1:0',
    );
    expect(translateModelId('meta.llama3-3-70b-instruct')).toBe(
      'us.meta.llama3-3-70b-instruct-v1:0',
    );
  });

  it('wraps mistral.pixtral-large-2502-v1:0 in the regional inference profile (only pixtral has a us.* profile)', () => {
    expect(translateModelId('mistral.pixtral-large-2502-v1:0')).toBe(
      'us.mistral.pixtral-large-2502-v1:0',
    );
  });

  it('keeps other mistral models bare — us.mistral.ministral-* is invalid on Bedrock', () => {
    expect(translateModelId('mistral.ministral-3-8b-instruct')).toBe('mistral.ministral-3-8b-instruct');
    expect(translateModelId('mistral.mistral-large-3-675b-instruct')).toBe('mistral.mistral-large-3-675b-instruct');
  });

  it('keeps google.gemma-* bare — us.google.* is invalid on Bedrock', () => {
    expect(translateModelId('google.gemma-3-27b-it')).toBe('google.gemma-3-27b-it');
    expect(translateModelId('google.gemma-4-27b-it')).toBe('google.gemma-4-27b-it');
  });

  it('keeps zai.glm-* bare — us.zai.* is invalid on Bedrock', () => {
    expect(translateModelId('zai.glm-5')).toBe('zai.glm-5');
    expect(translateModelId('zai.glm-4.7')).toBe('zai.glm-4.7');
  });

  it('passes through an already-regional Anthropic profile unchanged', () => {
    expect(translateModelId('us.anthropic.claude-sonnet-4-6')).toBe(
      'us.anthropic.claude-sonnet-4-6',
    );
  });

  it('passes through eu. and ap. regional profiles unchanged', () => {
    expect(translateModelId('eu.anthropic.claude-sonnet-4-6')).toBe(
      'eu.anthropic.claude-sonnet-4-6',
    );
    expect(translateModelId('ap.anthropic.claude-haiku-4-5')).toBe(
      'ap.anthropic.claude-haiku-4-5',
    );
  });

  it('passes through global. profiles unchanged', () => {
    expect(translateModelId('global.anthropic.claude-sonnet-4-6')).toBe(
      'global.anthropic.claude-sonnet-4-6',
    );
  });

  it('passes through an already-regional non-Anthropic profile unchanged', () => {
    expect(translateModelId('us.amazon.nova-lite-v1:0')).toBe('us.amazon.nova-lite-v1:0');
  });

  it('throws when model is missing', () => {
    expect(() => translateModelId(undefined)).toThrow('model is required');
    expect(() => translateModelId('')).toThrow('model is required');
    expect(() => translateModelId(null)).toThrow('model is required');
  });
});

describe('getModelNativeFormat', () => {
  it('returns anthropic for us.anthropic.* models', () => {
    expect(getModelNativeFormat('us.anthropic.claude-sonnet-4-6')).toBe('anthropic');
  });

  it('returns nova for us.amazon.nova-* models', () => {
    expect(getModelNativeFormat('us.amazon.nova-lite-v1:0')).toBe('nova');
    expect(getModelNativeFormat('amazon.nova-pro-v1:0')).toBe('nova');
  });

  it('returns openai for google.gemma-* models', () => {
    expect(getModelNativeFormat('google.gemma-3-27b-it')).toBe('openai');
  });

  it('returns openai for zai.glm-* models', () => {
    expect(getModelNativeFormat('zai.glm-5')).toBe('openai');
  });

  it('returns openai for us.deepseek.* models', () => {
    expect(getModelNativeFormat('us.deepseek.r1-v1:0')).toBe('openai');
  });

  it('returns openai for us.mistral.* models', () => {
    expect(getModelNativeFormat('us.mistral.pixtral-large-2502-v1:0')).toBe('openai');
  });

  it('returns meta for us.meta.* models', () => {
    expect(getModelNativeFormat('us.meta.llama3-3-70b-instruct-v1:0')).toBe('meta');
    expect(getModelNativeFormat('us.meta.llama4-scout-17b-16e-instruct-v1:0')).toBe('meta');
  });

  it('returns meta for bare meta.* models', () => {
    expect(getModelNativeFormat('meta.llama3-3-70b-instruct-v1:0')).toBe('meta');
  });
});

describe('normalizeResponse', () => {
  it('passes through Anthropic responses unchanged', () => {
    const resp = { type: 'message', content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 5, output_tokens: 2 } };
    expect(normalizeResponse(resp, 'anthropic', 'us.anthropic.claude-sonnet-4-6')).toBe(resp);
  });

  it('converts OpenAI-compat response to Anthropic format', () => {
    const resp = {
      id: 'chatcmpl-123',
      choices: [{ message: { content: 'Hello!' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 5, completion_tokens: 3 },
    };
    const normalized = normalizeResponse(resp, 'openai', 'google.gemma-3-27b-it');
    expect(normalized.type).toBe('message');
    expect(normalized.role).toBe('assistant');
    expect(normalized.content).toEqual([{ type: 'text', text: 'Hello!' }]);
    expect(normalized.stop_reason).toBe('end_turn');
    expect(normalized.usage).toEqual({ input_tokens: 5, output_tokens: 3 });
  });

  it('maps OpenAI finish_reason length → max_tokens stop_reason', () => {
    const resp = {
      choices: [{ message: { content: 'Truncated' }, finish_reason: 'length' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    };
    expect(normalizeResponse(resp, 'openai', 'zai.glm-5').stop_reason).toBe('max_tokens');
  });

  it('converts Meta Llama response to Anthropic format', () => {
    const resp = {
      generation: 'Hello there!',
      stop_reason: 'stop',
      prompt_token_count: 20,
      generation_token_count: 5,
    };
    const normalized = normalizeResponse(resp, 'meta', 'us.meta.llama3-3-70b-instruct-v1:0');
    expect(normalized.type).toBe('message');
    expect(normalized.role).toBe('assistant');
    expect(normalized.content).toEqual([{ type: 'text', text: 'Hello there!' }]);
    expect(normalized.stop_reason).toBe('end_turn');
    expect(normalized.usage).toEqual({ input_tokens: 20, output_tokens: 5 });
  });

  it('converts Nova response to Anthropic format', () => {
    const resp = {
      output: { message: { content: [{ text: 'Hi there!' }], role: 'assistant' } },
      stopReason: 'max_tokens',
      usage: { inputTokens: 4, outputTokens: 7 },
    };
    const normalized = normalizeResponse(resp, 'nova', 'us.amazon.nova-lite-v1:0');
    expect(normalized.type).toBe('message');
    expect(normalized.content).toEqual([{ type: 'text', text: 'Hi there!' }]);
    expect(normalized.stop_reason).toBe('max_tokens');
    expect(normalized.usage).toEqual({ input_tokens: 4, output_tokens: 7 });
  });
});

describe('translateRequestBody', () => {
  const baseBody = {
    model: 'claude-sonnet-4-6',
    messages: [{ role: 'user', content: 'hi' }],
    max_tokens: 100,
  };

  it('always injects anthropic_version: bedrock-2023-05-31 for Anthropic models', () => {
    const { body } = translateRequestBody(baseBody);
    expect(body.anthropic_version).toBe('bedrock-2023-05-31');
  });

  it('strips model from body and returns it as modelId with regional prefix', () => {
    const { body, modelId } = translateRequestBody(baseBody);
    expect(body.model).toBeUndefined();
    expect(modelId).toBe('us.anthropic.claude-sonnet-4-6');
  });

  it('returns format=anthropic for Anthropic models', () => {
    const { format } = translateRequestBody(baseBody);
    expect(format).toBe('anthropic');
  });

  it('passes messages through unchanged for Anthropic', () => {
    const { body } = translateRequestBody(baseBody);
    expect(body.messages).toEqual(baseBody.messages);
  });

  it('passes system through unchanged for Anthropic', () => {
    const input = { ...baseBody, system: 'You are helpful.' };
    const { body } = translateRequestBody(input);
    expect(body.system).toBe('You are helpful.');
  });

  it('drops stream — not in Bedrock allowlist', () => {
    const input = { ...baseBody, stream: true };
    const { body } = translateRequestBody(input);
    expect(body.stream).toBeUndefined();
  });

  it('drops context_management — Claude Code CLI field not accepted by Bedrock', () => {
    const input = { ...baseBody, context_management: { enabled: true } };
    const { body } = translateRequestBody(input);
    expect(body.context_management).toBeUndefined();
  });

  it('drops thinking — not in Bedrock allowlist', () => {
    const input = { ...baseBody, thinking: { type: 'adaptive' } };
    const { body } = translateRequestBody(input);
    expect(body.thinking).toBeUndefined();
  });

  it('drops metadata', () => {
    const input = { ...baseBody, metadata: { user_id: 'u1' } };
    const { body } = translateRequestBody(input);
    expect(body.metadata).toBeUndefined();
  });

  it('passes Bedrock-valid betas through and drops interleaved-thinking', () => {
    const { body } = translateRequestBody(
      baseBody,
      'interleaved-thinking-2025-05-14,extended-output-2025-06-30',
    );
    expect(body.anthropic_beta).toEqual(['extended-output-2025-06-30']);
  });

  it('filters out client-tool betas that Bedrock does not recognise', () => {
    const { body } = translateRequestBody(baseBody, 'claude-code-2025-03-07');
    expect(body.anthropic_beta).toBeUndefined();
  });

  it('caps max_tokens to maxOutputTokensPerRequest when the request exceeds it', () => {
    const { body } = translateRequestBody({ ...baseBody, max_tokens: 8000 }, undefined, {
      maxOutputTokensPerRequest: 4000,
    });
    expect(body.max_tokens).toBe(4000);
  });

  it('leaves max_tokens untouched when below the cap', () => {
    const { body } = translateRequestBody({ ...baseBody, max_tokens: 1000 }, undefined, {
      maxOutputTokensPerRequest: 4000,
    });
    expect(body.max_tokens).toBe(1000);
  });

  // -- OpenAI-compat models (Gemma, GLM, DeepSeek, Mistral) --

  it('produces OpenAI-compat body for google.gemma-* models', () => {
    const input = { model: 'google.gemma-3-27b-it', messages: [{ role: 'user', content: 'hello' }], max_tokens: 50 };
    const { body, format, modelId } = translateRequestBody(input);
    expect(format).toBe('openai');
    expect(modelId).toBe('google.gemma-3-27b-it');
    expect(body.messages).toEqual([{ role: 'user', content: 'hello' }]);
    expect(body.max_tokens).toBe(50);
    expect(body.anthropic_version).toBeUndefined();
  });

  it('produces OpenAI-compat body for zai.glm-* models', () => {
    const input = { model: 'zai.glm-5', messages: [{ role: 'user', content: 'hello' }], max_tokens: 50 };
    const { body, format } = translateRequestBody(input);
    expect(format).toBe('openai');
    expect(body.messages).toEqual([{ role: 'user', content: 'hello' }]);
    expect(body.anthropic_version).toBeUndefined();
  });

  it('converts array message content to string for OpenAI-compat models', () => {
    const input = {
      model: 'google.gemma-3-27b-it',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      max_tokens: 10,
    };
    const { body } = translateRequestBody(input);
    expect(body.messages[0].content).toBe('hello');
  });

  it('promotes system prompt to system message for OpenAI-compat models', () => {
    const input = {
      model: 'zai.glm-5',
      system: 'Be helpful.',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 10,
    };
    const { body } = translateRequestBody(input);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'Be helpful.' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'hi' });
  });

  it('caps max_tokens for OpenAI-compat models', () => {
    const input = { model: 'google.gemma-3-27b-it', messages: [{ role: 'user', content: 'hi' }], max_tokens: 8000 };
    const { body } = translateRequestBody(input, undefined, { maxOutputTokensPerRequest: 2000 });
    expect(body.max_tokens).toBe(2000);
  });

  // -- Meta Llama models --

  it('produces Meta prompt body for meta.* models', () => {
    const input = { model: 'meta.llama3-3-70b-instruct-v1:0', messages: [{ role: 'user', content: 'hello' }], max_tokens: 32 };
    const { body, format, modelId } = translateRequestBody(input);
    expect(format).toBe('meta');
    expect(modelId).toBe('us.meta.llama3-3-70b-instruct-v1:0');
    expect(body.prompt).toContain('<|begin_of_text|>');
    expect(body.prompt).toContain('<|start_header_id|>user<|end_header_id|>');
    expect(body.prompt).toContain('hello');
    expect(body.prompt).toContain('<|start_header_id|>assistant<|end_header_id|>');
    expect(body.max_gen_len).toBe(32);
    expect(body.messages).toBeUndefined();
    expect(body.anthropic_version).toBeUndefined();
  });

  it('includes system in Meta prompt when provided', () => {
    const input = {
      model: 'meta.llama3-3-70b-instruct-v1:0',
      system: 'You are concise.',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 16,
    };
    const { body } = translateRequestBody(input);
    expect(body.prompt).toContain('<|start_header_id|>system<|end_header_id|>');
    expect(body.prompt).toContain('You are concise.');
  });

  it('caps max_gen_len for Meta models', () => {
    const input = { model: 'meta.llama3-3-70b-instruct-v1:0', messages: [{ role: 'user', content: 'hi' }], max_tokens: 8000 };
    const { body } = translateRequestBody(input, undefined, { maxOutputTokensPerRequest: 1000 });
    expect(body.max_gen_len).toBe(1000);
  });

  // -- Nova models --

  it('produces Nova body for amazon.nova-* models', () => {
    const input = { model: 'amazon.nova-lite-v1:0', messages: [{ role: 'user', content: 'hello' }], max_tokens: 50 };
    const { body, format, modelId } = translateRequestBody(input);
    expect(format).toBe('nova');
    expect(modelId).toBe('us.amazon.nova-lite-v1:0');
    expect(body.messages[0]).toEqual({ role: 'user', content: [{ text: 'hello' }] });
    expect(body.inferenceConfig.maxTokens).toBe(50);
    expect(body.anthropic_version).toBeUndefined();
  });

  it('promotes system to Nova system block', () => {
    const input = {
      model: 'amazon.nova-lite-v1:0',
      system: 'Be concise.',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 10,
    };
    const { body } = translateRequestBody(input);
    expect(body.system).toEqual([{ text: 'Be concise.' }]);
  });
});
