'use strict';

const express = require('express');
const { bedrockProxyAuth } = require('../../middleware/aura/bedrockProxyAuth');
const { createUserRateLimiter, createIpRateLimiter } = require('../../middleware/aura/rateLimiter');
const {
  handleMessages,
  handleCountTokens,
} = require('../../controllers/aura/bedrockProxyController');

const router = express.Router();

const ipLimiter = createIpRateLimiter();
const userLimiter = createUserRateLimiter();

router.post('/v1/messages', ipLimiter, bedrockProxyAuth, userLimiter, handleMessages);
router.post(
  '/v1/messages/count_tokens',
  ipLimiter,
  bedrockProxyAuth,
  userLimiter,
  handleCountTokens,
);

module.exports = router;
