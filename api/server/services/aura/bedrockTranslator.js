'use strict';

// Allowlist of fields Bedrock InvokeModel accepts in the Anthropic-format request body.
// Using an allowlist (not a blocklist) means client-tool extras like
// context_management, thinking, stream, metadata, cache_control, etc. are
// silently dropped without needing per-field maintenance as the Anthropic
// API evolves.
const BEDROCK_BODY_FIELDS = new Set([
  'max_tokens',
  'messages',
  'system',
  'temperature',
  'top_p',
  'top_k',
  'stop_sequences',
  'tools',
  'tool_choice',
]);

// Only beta flags that Bedrock's InvokeModel API recognises for Anthropic models.
// interleaved-thinking-2025-05-14 is excluded: it is only valid on Opus 4.x
// with extended thinking, and we strip the `thinking` body field entirely.
// Passing it for Sonnet/Haiku causes "invalid beta flag" ValidationException.
const BEDROCK_VALID_BETAS = new Set(['extended-output-2025-06-30']);

// Providers where the cross-region inference prefix (us./eu./ap.) is NOT supported —
// these models must be invoked with their bare provider-prefixed ID.
// Confirmed via live testing and Bedrock inference-profile enumeration (2026-06-25):
//   google, zai            — confirmed bare-only via live test
//   minimax                — confirmed bare-only (us.minimax.* rejected)
//   moonshot, moonshotai, nvidia, openai, qwen, luma — no us.* profiles exist
//   mistral (most models)  — bare works; only pixtral-large has a us.* profile (see CROSS_REGION_MODEL_IDS)
//   deepseek (most models) — bare works; only r1-v1:0 has a us.* profile (see CROSS_REGION_MODEL_IDS)
const BARE_ONLY_PROVIDERS = new Set([
  'google', 'zai', 'minimax', 'moonshot', 'moonshotai', 'nvidia', 'openai', 'qwen', 'luma',
  'mistral', 'deepseek',
]);

// Specific model IDs that DO have confirmed cross-region inference profiles, even when their
// provider is in BARE_ONLY_PROVIDERS. These take priority over the provider-level bare rule.
const CROSS_REGION_MODEL_IDS = new Set([
  'deepseek.r1-v1:0',               // us.deepseek.r1-v1:0 confirmed valid
  'mistral.pixtral-large-2502-v1:0', // us.mistral.pixtral-large-2502-v1:0 confirmed valid
]);

function getRegionPrefix() {
  const region = process.env.AWS_REGION || 'us-east-1';
  if (region.startsWith('eu-')) return 'eu';
  if (region.startsWith('ap-')) return 'ap';
  return 'us';
}

function translateModelId(modelId) {
  if (!modelId) throw new Error('model is required');
  // Already a cross-region inference profile or global profile — pass through unchanged.
  if (
    modelId.startsWith('us.') ||
    modelId.startsWith('eu.') ||
    modelId.startsWith('ap.') ||
    modelId.startsWith('global.')
  ) {
    return modelId;
  }
  const prefix = getRegionPrefix();
  const dotIdx = modelId.indexOf('.');
  if (dotIdx > 0) {
    const provider = modelId.slice(0, dotIdx);
    // Specific models that have confirmed cross-region profiles take priority over provider-level rules.
    if (CROSS_REGION_MODEL_IDS.has(modelId)) {
      return `${prefix}.${modelId}`;
    }
    // These providers don't support cross-region inference profiles — use bare ID as-is.
    if (BARE_ONLY_PROVIDERS.has(provider)) {
      return modelId;
    }
    // All others (anthropic, amazon, meta, writer, cohere, etc.) — wrap in a regional prefix.
    // Anthropic date-versioned models need -v1:0 suffix in the inference profile ID
    // (e.g. anthropic.claude-haiku-4-5-20251001 → us.anthropic.claude-haiku-4-5-20251001-v1:0).
    const bare = modelId.slice(dotIdx + 1);
    const needsSuffix = provider === 'anthropic' && /\d{8}$/.test(bare);
    return `${prefix}.${needsSuffix ? `${modelId}-v1:0` : modelId}`;
  }
  // Bare model name with no provider prefix (e.g. 'claude-sonnet-4-6' from Claude Code) —
  // assume Anthropic and build the full regional cross-region inference profile ID.
  // Date-versioned models (e.g. claude-haiku-4-5-20251001) require a -v1:0 suffix in
  // the inference profile ID. New-style models (claude-sonnet-4-6, claude-fable-5) don't.
  const needsVersionSuffix = /\d{8}$/.test(modelId);
  const canonicalId = needsVersionSuffix ? `${modelId}-v1:0` : modelId;
  return `${prefix}.anthropic.${canonicalId}`;
}

// Detect which native request/response format a Bedrock model uses.
// 'anthropic' — Bedrock Anthropic format (anthropic_version, array content [{text}])
// 'nova'      — Amazon Nova format (messages w/ array content [{text}], inferenceConfig)
// 'meta'      — Meta Llama format (prompt string with chat template tokens, max_gen_len)
//               Used by: Meta Llama 3.x (us.meta.*, meta.*)
// 'openai'    — OpenAI-compatible (messages w/ string content, max_tokens, choices response)
//               Used by: Gemma (google.*), GLM (zai.*), DeepSeek, Mistral, Writer, MiniMax, Qwen
function getModelNativeFormat(modelId) {
  if (modelId.includes('.anthropic.')) return 'anthropic';
  if (modelId.includes('.nova') || modelId.startsWith('amazon.nova')) return 'nova';
  if (modelId.includes('.meta.') || modelId.startsWith('meta.')) return 'meta';
  return 'openai';
}

function mapStopReason(reason) {
  const MAP = { stop: 'end_turn', length: 'max_tokens', max_tokens: 'max_tokens', end_turn: 'end_turn' };
  return MAP[reason] ?? 'end_turn';
}

function extractSystemText(system) {
  if (!system) return null;
  if (typeof system === 'string') return system;
  return (system || []).map((c) => c.text ?? '').join('\n\n') || null;
}

function extractContentText(content) {
  if (typeof content === 'string') return content;
  return (content || []).map((c) => c.text ?? '').join('');
}

// Translate Anthropic body → Amazon Nova format.
// Nova uses messages with array content [{text}] and inferenceConfig.
function toNovaBody(anthropicBody, opts) {
  const maxTokensCap = opts?.maxOutputTokensPerRequest ?? null;
  const messages = (anthropicBody.messages || []).map((msg) => ({
    role: msg.role,
    content:
      typeof msg.content === 'string'
        ? [{ text: msg.content }]
        : (msg.content || []).map((c) => ({ text: c.text ?? '' })).filter((c) => c.text),
  }));
  const body = { messages };
  const sysText = extractSystemText(anthropicBody.system);
  if (sysText) body.system = [{ text: sysText }];
  const maxTokens = maxTokensCap ?? anthropicBody.max_tokens ?? 4096;
  body.inferenceConfig = { maxTokens };
  if (anthropicBody.temperature != null) body.inferenceConfig.temperature = anthropicBody.temperature;
  if (anthropicBody.top_p != null) body.inferenceConfig.topP = anthropicBody.top_p;
  if (anthropicBody.stop_sequences?.length) body.inferenceConfig.stopSequences = anthropicBody.stop_sequences;
  return body;
}

// Translate Anthropic body → OpenAI-compatible format.
// Used for Gemma (google.*), GLM (zai.*), DeepSeek (us.deepseek.*), Mistral (us.mistral.*), etc.
function toOpenAICompatBody(anthropicBody, opts) {
  const maxTokensCap = opts?.maxOutputTokensPerRequest ?? null;
  const messages = [];
  const sysText = extractSystemText(anthropicBody.system);
  if (sysText) messages.push({ role: 'system', content: sysText });
  for (const msg of anthropicBody.messages || []) {
    messages.push({ role: msg.role, content: extractContentText(msg.content) });
  }
  const body = { messages, max_tokens: maxTokensCap ?? anthropicBody.max_tokens ?? 4096 };
  if (anthropicBody.temperature != null) body.temperature = anthropicBody.temperature;
  if (anthropicBody.top_p != null) body.top_p = anthropicBody.top_p;
  if (anthropicBody.stop_sequences?.length) body.stop = anthropicBody.stop_sequences;
  return body;
}

// Translate Anthropic body → Meta Llama prompt format.
// Meta Llama 3.x on Bedrock uses a single `prompt` string with chat template tokens
// and `max_gen_len` (not `max_tokens`). It rejects `messages` and `max_tokens`.
function toMetaBody(anthropicBody, opts) {
  const maxTokensCap = opts?.maxOutputTokensPerRequest ?? null;
  const parts = [];
  const sysText = extractSystemText(anthropicBody.system);
  if (sysText) {
    parts.push(`<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\n${sysText}<|eot_id|>`);
  } else {
    parts.push('<|begin_of_text|>');
  }
  for (const msg of anthropicBody.messages || []) {
    const text = extractContentText(msg.content);
    parts.push(`<|start_header_id|>${msg.role}<|end_header_id|>\n\n${text}<|eot_id|>`);
  }
  parts.push('<|start_header_id|>assistant<|end_header_id|>\n\n');
  const body = { prompt: parts.join(''), max_gen_len: maxTokensCap ?? anthropicBody.max_tokens ?? 512 };
  if (anthropicBody.temperature != null) body.temperature = anthropicBody.temperature;
  if (anthropicBody.top_p != null) body.top_p = anthropicBody.top_p;
  return body;
}

// Extract system-role messages from the messages array and promote them to the
// top-level `system` field. Bedrock rejects { role: "system" } inside messages;
// it must be the top-level `system` parameter.
function extractSystemMessages(messages) {
  if (!Array.isArray(messages)) return { system: null, messages };
  const systemParts = [];
  const filtered = messages.filter((m) => {
    if (m.role !== 'system') return true;
    const content = extractContentText(m.content);
    if (content) systemParts.push(content);
    return false;
  });
  return { system: systemParts.length ? systemParts.join('\n\n') : null, messages: filtered };
}

// Convert a native Bedrock response back to Anthropic Messages API format so that
// Claude Code (and other Anthropic-compatible clients) can read all model responses uniformly.
function normalizeResponse(nativeResponse, format, modelId) {
  if (format === 'anthropic') return nativeResponse;

  if (format === 'nova') {
    const content = nativeResponse.output?.message?.content || [];
    return {
      id: `msg_nova_${nativeResponse.usage?.outputTokens ?? 0}`,
      type: 'message',
      role: 'assistant',
      model: modelId,
      content: content.map((c) => ({ type: 'text', text: c.text || '' })),
      stop_reason: mapStopReason(nativeResponse.stopReason),
      usage: {
        input_tokens: nativeResponse.usage?.inputTokens ?? 0,
        output_tokens: nativeResponse.usage?.outputTokens ?? 0,
      },
    };
  }

  if (format === 'meta') {
    return {
      id: `msg_meta_${nativeResponse.generation_token_count ?? 0}`,
      type: 'message',
      role: 'assistant',
      model: modelId,
      content: [{ type: 'text', text: nativeResponse.generation || '' }],
      stop_reason: mapStopReason(nativeResponse.stop_reason),
      usage: {
        input_tokens: nativeResponse.prompt_token_count ?? 0,
        output_tokens: nativeResponse.generation_token_count ?? 0,
      },
    };
  }

  // openai: choices[0].message.content, usage.prompt_tokens / completion_tokens
  const choice = nativeResponse.choices?.[0];
  return {
    id: nativeResponse.id || `msg_oai_${nativeResponse.usage?.completion_tokens ?? 0}`,
    type: 'message',
    role: 'assistant',
    model: modelId,
    content: [{ type: 'text', text: choice?.message?.content || '' }],
    stop_reason: mapStopReason(choice?.finish_reason || choice?.stop_reason),
    usage: {
      input_tokens: nativeResponse.usage?.prompt_tokens ?? 0,
      output_tokens: nativeResponse.usage?.completion_tokens ?? 0,
    },
  };
}

// opts.maxOutputTokensPerRequest — admin-set ceiling on max_tokens per call.
// Returns { modelId, body, format } where format is one of 'anthropic' | 'nova' | 'openai'.
// The caller uses format to correctly interpret the response.
function translateRequestBody(anthropicBody, anthropicBetaHeader, opts) {
  const modelId = translateModelId(anthropicBody.model);
  const maxOutputTokensCap = opts?.maxOutputTokensPerRequest ?? null;
  const format = getModelNativeFormat(modelId);

  let body;

  if (format === 'nova') {
    body = toNovaBody(anthropicBody, { maxOutputTokensPerRequest: maxOutputTokensCap });
  } else if (format === 'meta') {
    body = toMetaBody(anthropicBody, { maxOutputTokensPerRequest: maxOutputTokensCap });
  } else if (format === 'openai') {
    body = toOpenAICompatBody(anthropicBody, { maxOutputTokensPerRequest: maxOutputTokensCap });
  } else {
    // Anthropic native format — existing translation logic.
    body = { anthropic_version: 'bedrock-2023-05-31' };
    for (const [key, value] of Object.entries(anthropicBody)) {
      if (BEDROCK_BODY_FIELDS.has(key)) {
        body[key] = value;
      }
    }
    // Promote system-role messages to top-level system field.
    if (body.messages) {
      const { system, messages } = extractSystemMessages(body.messages);
      body.messages = messages;
      if (system && !body.system) body.system = system;
    }
    // Apply admin-set ceiling on output tokens.
    if (maxOutputTokensCap && (!body.max_tokens || body.max_tokens > maxOutputTokensCap)) {
      body.max_tokens = maxOutputTokensCap;
    }
    if (anthropicBetaHeader) {
      const filtered = anthropicBetaHeader
        .split(',')
        .map((s) => s.trim())
        .filter((b) => BEDROCK_VALID_BETAS.has(b));
      if (filtered.length > 0) body.anthropic_beta = filtered;
    }
  }

  return { modelId, body, format };
}

module.exports = {
  translateModelId,
  translateRequestBody,
  getModelNativeFormat,
  normalizeResponse,
};
