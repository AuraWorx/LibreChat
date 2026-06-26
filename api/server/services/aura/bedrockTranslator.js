'use strict';

// Allowlist of fields Bedrock InvokeModel accepts in the Anthropic-format request body.
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
const BEDROCK_VALID_BETAS = new Set(['extended-output-2025-06-30']);

// ─── Static fallback constants ─────────────────────────────────────────────────
// Used only when the dynamic model cache hasn't loaded yet (startup or API failure).
// Once the cache loads, ground-truth data from Bedrock's own APIs takes over.

const BARE_ONLY_PROVIDERS = new Set([
  'google', 'zai', 'minimax', 'moonshot', 'moonshotai', 'nvidia', 'openai', 'qwen', 'luma',
  'mistral', 'deepseek',
]);

const CROSS_REGION_MODEL_IDS = new Set([
  'deepseek.r1-v1:0',
  'mistral.pixtral-large-2502-v1:0',
]);

// ─── Dynamic Model Cache ───────────────────────────────────────────────────────
// On first translateRequestBody call, we fetch:
//   - ListFoundationModels  → all Bedrock model IDs (for canonical name resolution)
//   - ListInferenceProfiles → SYSTEM_DEFINED cross-region profiles (for us./eu./ap. routing)
// Cached for 6 hours; on failure, static fallback above is used for that request.

let _modelCache = null; // null = not loaded | { modelIds, profileIds, expiry }

async function ensureModelCache() {
  if (_modelCache && Date.now() < _modelCache.expiry) return;
  try {
    const {
      BedrockClient,
      ListFoundationModelsCommand,
      ListInferenceProfilesCommand,
    } = require('@aws-sdk/client-bedrock');
    const region = process.env.AWS_REGION || 'us-east-1';
    const client = new BedrockClient({ region });

    // Paginate inference profiles (ListFoundationModels doesn't paginate)
    async function allInferenceProfiles() {
      const ids = [];
      let nextToken;
      do {
        const resp = await client.send(
          new ListInferenceProfilesCommand({
            typeEquals: 'SYSTEM_DEFINED',
            ...(nextToken && { nextToken }),
          }),
        );
        for (const p of resp.inferenceProfileSummaries || []) ids.push(p.inferenceProfileId);
        nextToken = resp.nextToken;
      } while (nextToken);
      return ids;
    }

    const [modelsResp, profileIds] = await Promise.all([
      client.send(new ListFoundationModelsCommand({})),
      allInferenceProfiles(),
    ]);

    const summaries = modelsResp.modelSummaries || [];
    _modelCache = {
      modelIds: new Set(summaries.map((m) => m.modelId)),
      profileIds: new Set(profileIds),
      modelSummaries: new Map(summaries.map((m) => [m.modelId, m])),
      expiry: Date.now() + 6 * 60 * 60 * 1000, // 6 hours
    };
  } catch (err) {
    // Non-fatal: degrade to static fallback, retry next request.
    console.warn('[bedrockTranslator] model cache load failed, using static fallback:', err.message);
  }
}

// Injected by unit tests to avoid real AWS calls.
function _setTestCache(modelIds, profileIds) {
  _modelCache = { modelIds: new Set(modelIds), profileIds: new Set(profileIds), expiry: Infinity };
}
function _clearTestCache() {
  _modelCache = null;
}

// Resolve a (possibly abbreviated) model name to its canonical Bedrock foundation model ID.
// Handles version-suffix elision: 'meta.llama4-maverick-17b-instruct' resolves to
// 'meta.llama4-maverick-17b-instruct-v1:0' because the suffix '-v1:0' matches -vN:N.
function resolveCanonicalModelId(input) {
  if (!_modelCache) return input;
  if (_modelCache.modelIds.has(input)) return input;
  // Strip context-window variant suffixes like :128k, :64k that Bedrock doesn't use in model IDs
  const noCtx = input.replace(/:\d+k$/i, '');
  if (noCtx !== input && _modelCache.modelIds.has(noCtx)) return noCtx;
  // Forward: input is abbreviated, model ID has version suffix (e.g. -v1:0 or bare -v1)
  for (const id of _modelCache.modelIds) {
    if (id.startsWith(input) && /^-v\d+(:\d+)?$/.test(id.slice(input.length))) return id;
  }
  // Also try forward match after stripping :Nk context suffix
  if (noCtx !== input) {
    for (const id of _modelCache.modelIds) {
      if (id.startsWith(noCtx) && /^-v\d+(:\d+)?$/.test(id.slice(noCtx.length))) return id;
    }
  }
  // Reverse: input has a version suffix the canonical ID omits (e.g. google.gemma-3-27b-it-v1:0 → google.gemma-3-27b-it)
  const stripped = input.replace(/-v\d+(:\d+)?$/, '');
  if (stripped !== input && _modelCache.modelIds.has(stripped)) return stripped;
  return input; // no match — pass through as-is
}

// True if a SYSTEM_DEFINED cross-region inference profile exists for prefix.modelId.
function hasSystemInferenceProfile(modelId, prefix) {
  return !!_modelCache && _modelCache.profileIds.has(`${prefix}.${modelId}`);
}

// ─── Static fallback helpers ───────────────────────────────────────────────────

function getRegionPrefix() {
  const region = process.env.AWS_REGION || 'us-east-1';
  if (region.startsWith('eu-')) return 'eu';
  if (region.startsWith('ap-')) return 'ap';
  return 'us';
}

function staticTranslateModelId(modelId, prefix) {
  const dotIdx = modelId.indexOf('.');
  if (dotIdx <= 0) {
    // Bare name — assume Anthropic
    const needsVersionSuffix = /\d{8}$/.test(modelId);
    const canonicalId = needsVersionSuffix ? `${modelId}-v1:0` : modelId;
    return `${prefix}.anthropic.${canonicalId}`;
  }
  const provider = modelId.slice(0, dotIdx);

  // Version suffix normalization (handles common providers without touching mixed ones)
  let normalized = modelId;
  if (!/[-]v\d+:\d+$/.test(modelId)) {
    if (provider === 'meta') {
      normalized = `${modelId}-v1:0`;
    } else if (provider === 'deepseek') {
      const modelName = modelId.slice(dotIdx + 1);
      if (!modelName.includes('.')) normalized = `${modelId}-v1:0`;
    } else if (provider === 'amazon' && modelId.includes('nova')) {
      normalized = `${modelId}-v1:0`;
    }
  }

  if (CROSS_REGION_MODEL_IDS.has(normalized)) return `${prefix}.${normalized}`;
  if (BARE_ONLY_PROVIDERS.has(provider)) return normalized;

  const bare = normalized.slice(normalized.indexOf('.') + 1);
  const needsSuffix = provider === 'anthropic' && /\d{8}$/.test(bare);
  return `${prefix}.${needsSuffix ? `${normalized}-v1:0` : normalized}`;
}

// ─── Main translation ──────────────────────────────────────────────────────────

function translateModelId(modelId) {
  if (!modelId) throw new Error('model is required');
  // Already a full cross-region or global profile — pass through unchanged.
  if (
    modelId.startsWith('us.') ||
    modelId.startsWith('eu.') ||
    modelId.startsWith('ap.') ||
    modelId.startsWith('global.')
  ) {
    return modelId;
  }

  const prefix = getRegionPrefix();

  if (_modelCache) {
    // Dynamic path: resolve canonical model ID then check inference profile registry.
    const dotIdx = modelId.indexOf('.');
    if (dotIdx > 0) {
      const canonical = resolveCanonicalModelId(modelId);
      return hasSystemInferenceProfile(canonical, prefix)
        ? `${prefix}.${canonical}`
        : canonical;
    }
    // Bare name: prepend anthropic. and resolve via cache.
    const canonical = resolveCanonicalModelId(`anthropic.${modelId}`);
    return hasSystemInferenceProfile(canonical, prefix)
      ? `${prefix}.${canonical}`
      : `${prefix}.${canonical}`; // Anthropic always gets the prefix even without explicit profile
  }

  // Static fallback: cache not yet loaded.
  return staticTranslateModelId(modelId, prefix);
}

// ─── Format detection ──────────────────────────────────────────────────────────

// 'anthropic' — Bedrock Anthropic format (anthropic_version, array content [{text}])
// 'nova'      — Amazon Nova format (messages w/ array content [{text}], inferenceConfig)
// 'meta'      — Meta Llama format (prompt string with chat template tokens, max_gen_len)
// 'openai'    — OpenAI-compatible (messages w/ string content, max_tokens, choices response)
function getModelNativeFormat(modelId) {
  if (modelId.includes('.anthropic.')) return 'anthropic';
  if (modelId.includes('.nova') || modelId.startsWith('amazon.nova')) return 'nova';
  if (modelId.includes('.meta.') || modelId.startsWith('meta.')) return 'meta';
  return 'openai';
}

// ─── Body translators ──────────────────────────────────────────────────────────

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

// ─── Response normalizer ───────────────────────────────────────────────────────

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

  // openai
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

// ─── Main entry point ──────────────────────────────────────────────────────────

async function translateRequestBody(anthropicBody, anthropicBetaHeader, opts) {
  await ensureModelCache();

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
    // Anthropic native format
    body = { anthropic_version: 'bedrock-2023-05-31' };
    for (const [key, value] of Object.entries(anthropicBody)) {
      if (BEDROCK_BODY_FIELDS.has(key)) body[key] = value;
    }
    if (body.messages) {
      const { system, messages } = extractSystemMessages(body.messages);
      body.messages = messages;
      if (system && !body.system) body.system = system;
    }
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

// Returns Claude Code-compatible models (TEXT-in + TEXT-out + non-LEGACY).
// Used by the /bedrock/models.json proxy route.
async function getLiveModelList() {
  await ensureModelCache();
  if (!_modelCache) return null;

  const prefix = getRegionPrefix();
  const models = [];

  for (const id of _modelCache.modelIds) {
    const summary = _modelCache.modelSummaries && _modelCache.modelSummaries.get(id);
    const inputMods = summary ? (summary.inputModalities || []) : ['TEXT'];
    const outputMods = summary ? (summary.outputModalities || []) : ['TEXT'];
    const lifecycle = summary ? (summary.modelLifecycle && summary.modelLifecycle.status) : 'ACTIVE';

    if (!inputMods.includes('TEXT') || !outputMods.includes('TEXT') || lifecycle === 'LEGACY') {
      continue;
    }

    // Exclude non-generative models (rerank, embedding) — they have TEXT I/O but don't do chat
    if (/\brerank\b/i.test(id) || /\bembed\b/i.test(id)) continue;

    const bare = id.replace(/^(us|eu|ap)\./, '');
    const provider = (summary && summary.providerName) || bare.split('.')[0] || 'unknown';
    const name = (summary && summary.modelName) || id;
    const hasProfile = _modelCache.profileIds.has(`${prefix}.${id}`);

    // Exclude models that require an inference profile but have none available in this account
    const inferenceTypes = summary ? (summary.inferenceTypesSupported || []) : [];
    const profileOnly = inferenceTypes.length > 0 &&
      inferenceTypes.includes('INFERENCE_PROFILE') &&
      !inferenceTypes.includes('ON_DEMAND');
    if (profileOnly && !hasProfile) continue;

    models.push({
      id,
      name,
      provider,
      inputModalities: inputMods,
      outputModalities: outputMods,
      recommendedId: hasProfile ? `${prefix}.${id}` : id,
    });
  }

  models.sort((a, b) => a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id));
  return models;
}

module.exports = {
  translateModelId,
  translateRequestBody,
  getModelNativeFormat,
  normalizeResponse,
  getLiveModelList,
  _setTestCache,
  _clearTestCache,
};
