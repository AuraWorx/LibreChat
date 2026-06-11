'use strict';

// Allowlist of fields Bedrock InvokeModel accepts in the Claude request body.
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

// Only beta flags that Bedrock's InvokeModel API recognises for all models.
// interleaved-thinking-2025-05-14 is excluded: it is only valid on Opus 4.x
// with extended thinking, and we strip the `thinking` body field entirely.
// Passing it for Sonnet/Haiku causes "invalid beta flag" ValidationException.
const BEDROCK_VALID_BETAS = new Set(['extended-output-2025-06-30']);

function getRegionPrefix() {
  const region = process.env.AWS_REGION || 'us-east-1';
  if (region.startsWith('eu-')) return 'eu';
  if (region.startsWith('ap-')) return 'ap';
  return 'us';
}

function translateModelId(modelId) {
  if (!modelId) throw new Error('model is required');
  // Already a cross-region inference profile or global profile — pass through unchanged
  if (
    modelId.startsWith('us.') ||
    modelId.startsWith('eu.') ||
    modelId.startsWith('ap.') ||
    modelId.startsWith('global.')
  ) {
    return modelId;
  }
  // Strip bare 'anthropic.' prefix if present, then build the regional cross-region inference
  // profile ID that Bedrock requires for on-demand throughput (e.g. us.anthropic.claude-opus-4-8)
  const prefix = getRegionPrefix();
  const bare = modelId.startsWith('anthropic.') ? modelId.slice('anthropic.'.length) : modelId;
  return `${prefix}.anthropic.${bare}`;
}

// Extract system-role messages from the messages array and promote them to the
// top-level `system` field. Bedrock rejects { role: "system" } inside messages;
// it must be the top-level `system` parameter.
function extractSystemMessages(messages) {
  if (!Array.isArray(messages)) return { system: null, messages };
  const systemParts = [];
  const filtered = messages.filter((m) => {
    if (m.role !== 'system') return true;
    const content =
      typeof m.content === 'string'
        ? m.content
        : (m.content || []).map((c) => c.text ?? '').join('');
    if (content) systemParts.push(content);
    return false;
  });
  return { system: systemParts.length ? systemParts.join('\n\n') : null, messages: filtered };
}

// opts.maxOutputTokensPerRequest — admin-set ceiling on max_tokens per call.
function translateRequestBody(anthropicBody, anthropicBetaHeader, opts) {
  const modelId = translateModelId(anthropicBody.model);
  const maxOutputTokensCap = opts?.maxOutputTokensPerRequest ?? null;

  const body = { anthropic_version: 'bedrock-2023-05-31' };

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

  return { modelId, body };
}

module.exports = { translateModelId, translateRequestBody };
