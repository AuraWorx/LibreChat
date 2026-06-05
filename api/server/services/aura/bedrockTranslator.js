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

// Only beta flags that Bedrock's InvokeModel API recognises.
// Client tools (Claude Code, Cursor, Cline) inject their own betas
// (e.g. claude-code-2025-03-07) which Bedrock rejects with ValidationException.
const BEDROCK_VALID_BETAS = new Set([
  'interleaved-thinking-2025-05-14',
  'extended-output-2025-06-30',
]);

function translateModelId(modelId) {
  if (!modelId) throw new Error('model is required');
  // Pass through fully-qualified Bedrock model IDs and cross-region inference profiles unchanged
  if (modelId.startsWith('anthropic.') || modelId.startsWith('us.') || modelId.startsWith('global.') || modelId.startsWith('eu.') || modelId.startsWith('ap.')) {
    return modelId;
  }
  return `anthropic.${modelId}`;
}

function translateRequestBody(anthropicBody, anthropicBetaHeader) {
  const modelId = translateModelId(anthropicBody.model);

  const body = { anthropic_version: 'bedrock-2023-05-31' };

  for (const [key, value] of Object.entries(anthropicBody)) {
    if (BEDROCK_BODY_FIELDS.has(key)) {
      body[key] = value;
    }
  }

  if (anthropicBetaHeader) {
    const filtered = anthropicBetaHeader.split(',').map((s) => s.trim()).filter((b) => BEDROCK_VALID_BETAS.has(b));
    if (filtered.length > 0) body.anthropic_beta = filtered;
  }

  return { modelId, body };
}

module.exports = { translateModelId, translateRequestBody };
