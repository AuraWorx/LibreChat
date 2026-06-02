'use strict';

const rateLimit = require('express-rate-limit');

function createUserRateLimiter() {
  const max = parseInt(process.env.BEDROCK_PROXY_RPM_USER) || 60;
  const windowMs = (parseInt(process.env.BEDROCK_PROXY_RPM_USER_WINDOW) || 1) * 60 * 1000;

  const limiter = rateLimit({
    windowMs,
    max,
    keyGenerator: (req) => req.bedrockKeyDoc?.userId?.toString() ?? req.ip,
    handler: (req, res) => {
      res.set('Retry-After', '60');
      res.status(429).json({ error: 'rate_limit_error', message: 'Per-user rate limit exceeded' });
    },
    skip: (req) => !req.bedrockKeyDoc,
    standardHeaders: true,
    legacyHeaders: false,
  });

  limiter.max = max;
  limiter.keyGenerator = (req) => req.bedrockKeyDoc?.userId?.toString() ?? req.ip;
  return limiter;
}

function createIpRateLimiter() {
  const max = parseInt(process.env.BEDROCK_PROXY_RPM_IP) || 600;
  const windowMs = (parseInt(process.env.BEDROCK_PROXY_RPM_IP_WINDOW) || 1) * 60 * 1000;

  const limiter = rateLimit({
    windowMs,
    max,
    handler: (req, res) => {
      res.set('Retry-After', '60');
      res.status(429).json({ error: 'rate_limit_error', message: 'Per-IP rate limit exceeded' });
    },
    standardHeaders: true,
    legacyHeaders: false,
  });

  limiter.max = max;
  return limiter;
}

module.exports = { createUserRateLimiter, createIpRateLimiter };
