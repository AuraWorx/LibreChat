'use strict';

const DROPPED_FIELDS = new Set([
  'metadata', 'cache_control', 'service_tier', 'output_config', 'container', 'inference_geo', 'model',
  'thinking', 'stream',
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
    if (!DROPPED_FIELDS.has(key)) {
      body[key] = value;
    }
  }

  if (anthropicBetaHeader) {
    body.anthropic_beta = anthropicBetaHeader.split(',').map((s) => s.trim()).filter(Boolean);
    if (body.anthropic_beta.length === 0) delete body.anthropic_beta;
  }

  return { modelId, body };
}

module.exports = { translateModelId, translateRequestBody };
