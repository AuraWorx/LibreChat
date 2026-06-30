'use strict';

const {
  BedrockRuntimeClient,
  InvokeModelCommand,
  InvokeModelWithResponseStreamCommand,
  CountTokensCommand,
} = require('@aws-sdk/client-bedrock-runtime');
const {
  translateRequestBody,
  normalizeResponse,
} = require('../../services/aura/bedrockTranslator');
const {
  streamBedrockResponse,
  streamOpenAICompatResponse,
} = require('../../services/aura/bedrockStreamer');
const auditLogger = require('../../services/aura/auditLogger');
const BedrockDailyUsage = require('../../../models/aura/BedrockDailyUsage');
const BedrockProxyConfig = require('../../../models/aura/BedrockProxyConfig');

function getClient() {
  return new BedrockRuntimeClient({ region: process.env.AWS_REGION || 'us-east-1' });
}

const ERROR_MAP = {
  ThrottlingException: {
    status: 429,
    retryAfter: '10',
    error: 'rate_limit_error',
    message: 'Bedrock throttled the request',
  },
  ValidationException: {
    status: 400,
    error: 'invalid_request_error',
    message: 'Invalid request parameters',
  },
  AccessDeniedException: {
    status: 403,
    error: 'permission_error',
    message: 'Access denied to Bedrock model',
  },
  ModelNotReadyException: {
    status: 503,
    retryAfter: '15',
    error: 'overloaded_error',
    message: 'Model not ready, retry shortly',
  },
  ResourceNotFoundException: { status: 404, error: 'not_found_error', message: 'Model not found' },
};

function mapError(err, res) {
  const mapped = ERROR_MAP[err.name] ?? {
    status: 500,
    error: 'api_error',
    message: 'Internal proxy error',
  };
  if (mapped.retryAfter) res.set('Retry-After', mapped.retryAfter);
  res.status(mapped.status).json({ error: mapped.error, message: mapped.message });
  return mapped.status;
}

function getEnvLimit(envVar) {
  const v = parseInt(process.env[envVar] || '0', 10);
  return v > 0 ? v : null;
}

// 60-second in-memory cache for DB-stored default limits
let _dbDefaultsCache = null;
let _dbDefaultsCacheAt = 0;
const DB_DEFAULTS_TTL_MS = 60_000;

async function getDbDefaults() {
  const now = Date.now();
  if (_dbDefaultsCache && now - _dbDefaultsCacheAt < DB_DEFAULTS_TTL_MS) {
    return _dbDefaultsCache;
  }
  try {
    const doc = await BedrockProxyConfig.findById('default').lean();
    _dbDefaultsCache = doc ?? null;
    _dbDefaultsCacheAt = now;
  } catch (err) {
    // Fail open: a transient config-read failure must not take the proxy down.
    // We degrade to env-based limits (which need no DB) and the stale cache if
    // any, but log loudly so the degradation is observable rather than silent.
    console.error('[bedrock_config_error]', err.message);
    if (!_dbDefaultsCache) _dbDefaultsCache = null;
  }
  return _dbDefaultsCache;
}

// Global default is the hard ceiling — take the minimum across all active limits.
// Per-key limits can only be more restrictive, never more permissive than global.
function hardMin(...values) {
  const active = values.filter((v) => v != null && v > 0);
  return active.length > 0 ? Math.min(...active) : null;
}

async function getEffectiveLimits(keyDoc) {
  const k = keyDoc?.limits ?? {};
  const db = await getDbDefaults();
  const kd = db?.keyDefaults ?? {};
  return {
    // Per-request: hard ceiling — most restrictive of key, global, env
    maxOutputTokensPerRequest: hardMin(
      k.maxOutputTokensPerRequest,
      db?.maxOutputTokensPerRequest,
      getEnvLimit('BEDROCK_MAX_OUTPUT_TOKENS_PER_REQUEST'),
    ),
    // Per-key daily: key's own limit, falling back to key defaults (then env)
    dailyInputTokens:
      k.dailyInputTokens ?? kd.dailyInputTokens ?? getEnvLimit('BEDROCK_DAILY_INPUT_TOKEN_LIMIT'),
    dailyOutputTokens:
      k.dailyOutputTokens ??
      kd.dailyOutputTokens ??
      getEnvLimit('BEDROCK_DAILY_OUTPUT_TOKEN_LIMIT'),
    dailyCacheWriteTokens:
      k.dailyCacheWriteTokens ??
      kd.dailyCacheWriteTokens ??
      getEnvLimit('BEDROCK_DAILY_CACHE_WRITE_TOKEN_LIMIT'),
  };
}

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

// Returns null if OK, or { limit_type, limit, used } if fully exhausted.
// Also returns remainingOutputTokens — the tightest remaining daily output budget
// across per-key and org limits, so the caller can cap max_tokens accordingly.
async function checkDailyLimits(userId, limits) {
  const today = todayUTC();
  let remainingOutputTokens = null; // null = no output limit configured

  // 1. Per-key daily check
  if (limits.dailyInputTokens || limits.dailyOutputTokens || limits.dailyCacheWriteTokens) {
    const usage = await BedrockDailyUsage.findOne({ userId, date: today }).lean();
    const used = usage ?? { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0 };
    if (limits.dailyInputTokens && used.inputTokens >= limits.dailyInputTokens) {
      return {
        exhausted: true,
        limit_type: 'daily_input_tokens',
        limit: limits.dailyInputTokens,
        used: used.inputTokens,
      };
    }
    if (limits.dailyOutputTokens && used.outputTokens >= limits.dailyOutputTokens) {
      return {
        exhausted: true,
        limit_type: 'daily_output_tokens',
        limit: limits.dailyOutputTokens,
        used: used.outputTokens,
      };
    }
    if (limits.dailyCacheWriteTokens && used.cacheWriteTokens >= limits.dailyCacheWriteTokens) {
      return {
        exhausted: true,
        limit_type: 'daily_cache_write_tokens',
        limit: limits.dailyCacheWriteTokens,
        used: used.cacheWriteTokens,
      };
    }
    if (limits.dailyOutputTokens) {
      remainingOutputTokens = limits.dailyOutputTokens - used.outputTokens;
    }
  }

  // 2. Org aggregate check
  const db = await getDbDefaults();
  const org = db?.orgBudget ?? {};
  if (org.dailyInputTokens || org.dailyOutputTokens || org.dailyCacheWriteTokens) {
    const globalUsage = await BedrockDailyUsage.findOne({
      userId: '__global__',
      date: today,
    }).lean();
    const gused = globalUsage ?? { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 0 };
    if (org.dailyInputTokens && gused.inputTokens >= org.dailyInputTokens) {
      return {
        exhausted: true,
        limit_type: 'org_daily_input_tokens',
        limit: org.dailyInputTokens,
        used: gused.inputTokens,
      };
    }
    if (org.dailyOutputTokens && gused.outputTokens >= org.dailyOutputTokens) {
      return {
        exhausted: true,
        limit_type: 'org_daily_output_tokens',
        limit: org.dailyOutputTokens,
        used: gused.outputTokens,
      };
    }
    if (org.dailyCacheWriteTokens && gused.cacheWriteTokens >= org.dailyCacheWriteTokens) {
      return {
        exhausted: true,
        limit_type: 'org_daily_cache_write_tokens',
        limit: org.dailyCacheWriteTokens,
        used: gused.cacheWriteTokens,
      };
    }
    if (org.dailyOutputTokens) {
      const orgRemaining = org.dailyOutputTokens - gused.outputTokens;
      remainingOutputTokens =
        remainingOutputTokens === null
          ? orgRemaining
          : Math.min(remainingOutputTokens, orgRemaining);
    }
  }

  return { exhausted: false, remainingOutputTokens };
}

function incrementUsage(userId, counters) {
  const today = todayUTC();
  BedrockDailyUsage.increment(userId, today, counters).catch((err) =>
    console.error('[bedrock_usage_error]', err.message),
  );
  // Also accumulate into the org-wide aggregate bucket
  BedrockDailyUsage.increment('__global__', today, counters).catch((err) =>
    console.error('[bedrock_global_usage_error]', err.message),
  );
}

function checkAllowedModels(requestedModel, keyDoc) {
  const keyAllowed = keyDoc?.allowedModels;
  const globalAllowed = process.env.BEDROCK_ALLOWED_MODELS
    ? process.env.BEDROCK_ALLOWED_MODELS.split(',')
        .map((m) => m.trim())
        .filter(Boolean)
    : null;
  const effective = keyAllowed?.length ? keyAllowed : globalAllowed;
  if (!effective || !effective.length) return null;
  const bare = requestedModel.replace(/^(anthropic\.|us\.|global\.|eu\.|ap\.)/, '');
  if (
    effective.some(
      (m) =>
        m === requestedModel ||
        m.includes(bare) ||
        requestedModel.includes(m.replace(/^(us\.|anthropic\.)/, '')),
    )
  ) {
    return null;
  }
  return {
    error: 'model_not_permitted',
    message: `Model ${requestedModel} is not permitted for this key`,
  };
}

async function handleMessages(req, res) {
  const start = Date.now();
  const { body: anthropicBody, headers, bedrockKeyDoc } = req;
  const betaHeader = headers['anthropic-beta'];
  const isStreaming = anthropicBody.stream === true;
  const userId = bedrockKeyDoc?.userId;

  let statusCode = 200;
  let requestTokens = -1;
  let responseTokens = -1;
  let cacheWriteTokens = 0;
  let cacheReadTokens = 0;

  try {
    // Model allowlist check
    const modelError = checkAllowedModels(anthropicBody.model, bedrockKeyDoc);
    if (modelError) {
      statusCode = 403;
      return res.status(403).json(modelError);
    }

    // Daily token limit pre-call check
    const limits = await getEffectiveLimits(bedrockKeyDoc);
    const dailyCheck = await checkDailyLimits(userId, limits);
    if (dailyCheck.exhausted) {
      // Use 400 instead of 429 — the Anthropic SDK retries 429s automatically which causes
      // Claude Code to loop indefinitely. 400 is non-retriable and surfaces as a clear error.
      statusCode = 400;
      const { exhausted: _x, remainingOutputTokens: _r, ...errorFields } = dailyCheck;
      return res.status(400).json({
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: 'Daily token budget exhausted. Resets at midnight UTC.',
        },
        ...errorFields,
      });
    }

    // Cap max_tokens to the tightest of: per-request ceiling and remaining daily output budget
    const effectiveOutputCap = hardMin(
      limits.maxOutputTokensPerRequest,
      dailyCheck.remainingOutputTokens,
    );
    const { modelId, body, format } = await translateRequestBody(anthropicBody, betaHeader, {
      maxOutputTokensPerRequest: effectiveOutputCap,
    });
    const bodyBytes = Buffer.from(JSON.stringify(body));

    if (isStreaming) {
      const command = new InvokeModelWithResponseStreamCommand({
        modelId,
        body: bodyBytes,
        contentType: 'application/json',
        accept: 'application/json',
      });
      const response = await getClient().send(command);
      const streamer = format === 'anthropic' ? streamBedrockResponse : streamOpenAICompatResponse;
      const usage = await streamer(response.body, res, modelId);
      requestTokens = usage.inputTokens || -1;
      responseTokens = usage.outputTokens || -1;
      cacheWriteTokens = usage.cacheWriteTokens;
      cacheReadTokens = usage.cacheReadTokens;
    } else {
      const command = new InvokeModelCommand({
        modelId,
        body: bodyBytes,
        contentType: 'application/json',
        accept: 'application/json',
      });
      const response = await getClient().send(command);
      const parsed = JSON.parse(Buffer.from(response.body).toString('utf8'));
      const normalized = normalizeResponse(parsed, format, modelId);
      requestTokens = normalized.usage?.input_tokens ?? -1;
      responseTokens = normalized.usage?.output_tokens ?? -1;
      cacheWriteTokens = normalized.usage?.cache_creation_input_tokens ?? 0;
      cacheReadTokens = normalized.usage?.cache_read_input_tokens ?? 0;
      res.status(200).json(normalized);
    }
  } catch (err) {
    console.error('[bedrock_proxy_error]', err.name, err.message);
    statusCode = mapError(err, res);
  } finally {
    auditLogger.proxyRequest({
      userId,
      keyId: bedrockKeyDoc?._id,
      model: anthropicBody.model,
      requestTokens,
      responseTokens,
      cacheWriteTokens,
      cacheReadTokens,
      durationMs: Date.now() - start,
      statusCode,
    });
    // Fire-and-forget daily accumulator update on success only
    if (statusCode === 200 && userId) {
      incrementUsage(userId, {
        inputTokens: requestTokens > 0 ? requestTokens : 0,
        outputTokens: responseTokens > 0 ? responseTokens : 0,
        cacheWriteTokens,
        cacheReadTokens,
      });
    }
  }
}

async function handleCountTokens(req, res) {
  const { body: anthropicBody, headers, bedrockKeyDoc } = req;
  const betaHeader = headers['anthropic-beta'];
  const limits = await getEffectiveLimits(bedrockKeyDoc);

  try {
    const { modelId, body, format } = await translateRequestBody(anthropicBody, betaHeader, {
      maxOutputTokensPerRequest: limits.maxOutputTokensPerRequest,
    });

    // CountTokensCommand is Anthropic-only. For other formats, return a character-based
    // estimate (~4 chars/token) so Claude Code's pre-flight check doesn't error out.
    if (format !== 'anthropic') {
      const text =
        JSON.stringify(anthropicBody.messages || []) + JSON.stringify(anthropicBody.system || '');
      return res.status(200).json({ input_tokens: Math.ceil(text.length / 4) });
    }

    delete body.stream;
    const bodyBytes = Buffer.from(JSON.stringify(body));
    const command = new CountTokensCommand({
      modelId,
      body: bodyBytes,
      contentType: 'application/json',
    });
    const response = await getClient().send(command);
    res.status(200).json({ input_tokens: response.inputTokenCount });
  } catch (err) {
    mapError(err, res);
  }
}

module.exports = {
  handleMessages,
  handleCountTokens,
  // Exported for unit testing of the spend-control logic.
  hardMin,
  getEnvLimit,
  getEffectiveLimits,
  checkDailyLimits,
  incrementUsage,
};
