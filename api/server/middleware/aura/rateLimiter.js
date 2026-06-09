'use strict';

const rateLimit = require('express-rate-limit');
const { ipKeyGenerator } = rateLimit;

function createUserRateLimiter() {
  const max = parseInt(process.env.BEDROCK_PROXY_RPM_USER) || 60;
  const windowMs = (parseInt(process.env.BEDROCK_PROXY_RPM_USER_WINDOW) || 1) * 60 * 1000;

  // Key on the authenticated user; fall back to the client IP only if the key
  // doc is somehow missing. ipKeyGenerator normalizes IPv6 to its /56 subnet so
  // a client cannot rotate addresses within a block to bypass the limit.
  const keyGenerator = (req) => req.bedrockKeyDoc?.userId?.toString() ?? ipKeyGenerator(req.ip);

  const limiter = rateLimit({
    windowMs,
    max,
    keyGenerator,
    handler: (req, res) => {
      res.set('Retry-After', '60');
      res.status(429).json({ error: 'rate_limit_error', message: 'Per-user rate limit exceeded' });
    },
    skip: (req) => !req.bedrockKeyDoc,
    standardHeaders: true,
    legacyHeaders: false,
  });

  limiter.max = max;
  limiter.keyGenerator = keyGenerator;
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
