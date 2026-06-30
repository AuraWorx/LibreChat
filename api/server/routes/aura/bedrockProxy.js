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

router.post('/v1/messages', ipLimiter, bedrockProxyAuth, userLimiter, handleMessages);
router.post(
  '/v1/messages/count_tokens',
  ipLimiter,
  bedrockProxyAuth,
  userLimiter,
  handleCountTokens,
);

module.exports = router;
