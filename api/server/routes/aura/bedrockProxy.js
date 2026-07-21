'use strict';

const express = require('express');
const { bedrockProxyAuth } = require('../../middleware/aura/bedrockProxyAuth');
const { createUserRateLimiter, createIpRateLimiter } = require('../../middleware/aura/rateLimiter');
const {
  handleMessages,
  handleCountTokens,
} = require('../../controllers/aura/bedrockProxyController');
const { getLiveModelList } = require('../../services/aura/bedrockTranslator');

const router = express.Router();

const ipLimiter = createIpRateLimiter();
const userLimiter = createUserRateLimiter();

// Public — returns Claude Code-compatible Bedrock models for the UI
router.get('/models.json', async (req, res) => {
  try {
    const models = await getLiveModelList();
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.json({ models: models || [] });
  } catch (err) {
    res.status(500).json({ models: [] });
  }
});

// Anthropic-compatible model list — GET /v1/models
// Called by Claude for Office (Word add-in) and Claude Code before any /v1/messages call.
router.get('/v1/models', ipLimiter, bedrockProxyAuth, async (req, res) => {
  try {
    const models = await getLiveModelList();
    const data = (models || [])
      .filter((m) => m.id.includes('anthropic.'))
      .map((m) => ({
        type: 'model',
        id: m.recommendedId,
        display_name: m.name,
        created_at: 1735689600,
      }));
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.json({
      data,
      has_more: false,
      first_id: data[0]?.id ?? null,
      last_id: data[data.length - 1]?.id ?? null,
    });
  } catch (err) {
    res.status(500).json({ error: { type: 'api_error', message: 'Failed to list models' } });
  }
});

// Single model lookup — GET /v1/models/:modelId
// Used by SDK versions that validate the target model before invoking /v1/messages.
router.get('/v1/models/:modelId', ipLimiter, bedrockProxyAuth, async (req, res) => {
  try {
    const models = await getLiveModelList();
    const found = (models || []).find(
      (m) => m.recommendedId === req.params.modelId || m.id === req.params.modelId,
    );
    if (!found) {
      return res
        .status(404)
        .json({ error: { type: 'not_found_error', message: `Model '${req.params.modelId}' not found` } });
    }
    res.json({ type: 'model', id: found.recommendedId, display_name: found.name, created_at: 1735689600 });
  } catch (err) {
    res.status(500).json({ error: { type: 'api_error', message: 'Failed to get model' } });
  }
});

router.post('/v1/messages', ipLimiter, bedrockProxyAuth, userLimiter, handleMessages);
router.post(
  '/v1/messages/count_tokens',
  ipLimiter,
  bedrockProxyAuth,
  userLimiter,
  handleCountTokens,
);

module.exports = router;
