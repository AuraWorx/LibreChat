'use strict';

// External deps the controller imports at module load — mocked so requiring the
// controller is cheap and side-effect free. The spend-control internals under
// test never invoke them.
jest.mock('@aws-sdk/client-bedrock-runtime');
jest.mock('../../services/aura/bedrockStreamer');
jest.mock('../../services/aura/auditLogger');
jest.mock('../../../models/aura/BedrockDailyUsage');
jest.mock('../../../models/aura/BedrockProxyConfig');

const CONFIG_PATH = '../../../models/aura/BedrockProxyConfig';
const USAGE_PATH = '../../../models/aura/BedrockDailyUsage';

const leanOf = (value) => ({ lean: () => Promise.resolve(value) });

let ctrl;
let BedrockDailyUsage;
let BedrockProxyConfig;

// The controller keeps a 60s in-memory cache for DB defaults. Re-require it
// (and the mocked models it binds to) fresh per test so cache state never leaks.
beforeEach(() => {
  jest.resetModules();
  BedrockDailyUsage = require(USAGE_PATH);
  BedrockProxyConfig = require(CONFIG_PATH);
  BedrockProxyConfig.findById.mockReturnValue(leanOf(null));
  BedrockDailyUsage.findOne.mockReturnValue(leanOf(null));
  BedrockDailyUsage.increment.mockResolvedValue(undefined);
  ctrl = require('./bedrockProxyController');
});

describe('hardMin', () => {
  it('returns the smallest active (positive) value', () => {
    expect(ctrl.hardMin(100, 50, 200)).toBe(50);
  });

  it('ignores null, undefined, zero, and negative values', () => {
    expect(ctrl.hardMin(null, undefined, 0, -5, 80)).toBe(80);
  });

  it('returns null when no value is active', () => {
    expect(ctrl.hardMin(null, 0, undefined)).toBeNull();
  });
});

describe('getEnvLimit', () => {
  afterEach(() => {
    delete process.env.BEDROCK_TEST_LIMIT;
  });

  it('parses a positive integer env var', () => {
    process.env.BEDROCK_TEST_LIMIT = '500';
    expect(ctrl.getEnvLimit('BEDROCK_TEST_LIMIT')).toBe(500);
  });

  it('returns null when unset', () => {
    expect(ctrl.getEnvLimit('BEDROCK_TEST_LIMIT')).toBeNull();
  });

  it('returns null for a non-positive value', () => {
    process.env.BEDROCK_TEST_LIMIT = '0';
    expect(ctrl.getEnvLimit('BEDROCK_TEST_LIMIT')).toBeNull();
  });
});

describe('getEffectiveLimits', () => {
  it('takes the most restrictive maxOutputTokensPerRequest across key and db', async () => {
    BedrockProxyConfig.findById.mockReturnValue(leanOf({ maxOutputTokensPerRequest: 4000 }));
    const limits = await ctrl.getEffectiveLimits({ limits: { maxOutputTokensPerRequest: 2000 } });
    expect(limits.maxOutputTokensPerRequest).toBe(2000);
  });

  it('falls back to db keyDefaults when the key sets no daily output limit', async () => {
    BedrockProxyConfig.findById.mockReturnValue(
      leanOf({ keyDefaults: { dailyOutputTokens: 9000 } }),
    );
    const limits = await ctrl.getEffectiveLimits({ limits: {} });
    expect(limits.dailyOutputTokens).toBe(9000);
  });

  it("prefers the key's own daily limit over db keyDefaults", async () => {
    BedrockProxyConfig.findById.mockReturnValue(
      leanOf({ keyDefaults: { dailyOutputTokens: 9000 } }),
    );
    const limits = await ctrl.getEffectiveLimits({ limits: { dailyOutputTokens: 1000 } });
    expect(limits.dailyOutputTokens).toBe(1000);
  });

  it('resolves all daily limits to null when nothing is configured', async () => {
    const limits = await ctrl.getEffectiveLimits({ limits: {} });
    expect(limits.dailyInputTokens).toBeNull();
    expect(limits.dailyOutputTokens).toBeNull();
    expect(limits.maxOutputTokensPerRequest).toBeNull();
  });
});

describe('checkDailyLimits', () => {
  it('returns not-exhausted with null remaining when no limits are configured', async () => {
    const result = await ctrl.checkDailyLimits('user1', {});
    expect(result).toEqual({ exhausted: false, remainingOutputTokens: null });
  });

  it('flags per-key daily output exhaustion', async () => {
    BedrockDailyUsage.findOne.mockReturnValue(leanOf({ outputTokens: 5000 }));
    const result = await ctrl.checkDailyLimits('user1', { dailyOutputTokens: 5000 });
    expect(result).toMatchObject({
      exhausted: true,
      limit_type: 'daily_output_tokens',
      limit: 5000,
      used: 5000,
    });
  });

  it('computes the remaining per-key output budget when under limit', async () => {
    BedrockDailyUsage.findOne.mockReturnValue(leanOf({ outputTokens: 1000 }));
    const result = await ctrl.checkDailyLimits('user1', { dailyOutputTokens: 5000 });
    expect(result).toEqual({ exhausted: false, remainingOutputTokens: 4000 });
  });

  it('flags org aggregate exhaustion from the __global__ bucket', async () => {
    BedrockProxyConfig.findById.mockReturnValue(
      leanOf({ orgBudget: { dailyOutputTokens: 10000 } }),
    );
    BedrockDailyUsage.findOne.mockReturnValue(leanOf({ outputTokens: 10000 }));
    const result = await ctrl.checkDailyLimits('user1', {});
    expect(result).toMatchObject({
      exhausted: true,
      limit_type: 'org_daily_output_tokens',
      limit: 10000,
      used: 10000,
    });
  });

  it('tightens remaining output to the smaller of per-key and org budgets', async () => {
    BedrockProxyConfig.findById.mockReturnValue(leanOf({ orgBudget: { dailyOutputTokens: 3000 } }));
    BedrockDailyUsage.findOne
      .mockReturnValueOnce(leanOf({ outputTokens: 1000 })) // per-key bucket: 5000 - 1000 = 4000
      .mockReturnValueOnce(leanOf({ outputTokens: 500 })); // org bucket:    3000 -  500 = 2500
    const result = await ctrl.checkDailyLimits('user1', { dailyOutputTokens: 5000 });
    expect(result).toEqual({ exhausted: false, remainingOutputTokens: 2500 });
  });
});

describe('getDbDefaults fail-open observability', () => {
  it('logs an error and degrades to no DB-configured limits when the config read fails', async () => {
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    BedrockProxyConfig.findById.mockReturnValue({
      lean: () => Promise.reject(new Error('db down')),
    });
    const limits = await ctrl.getEffectiveLimits({ limits: {} });
    expect(limits.dailyOutputTokens).toBeNull();
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('bedrock'), expect.anything());
    errSpy.mockRestore();
  });
});

describe('incrementUsage', () => {
  it('increments both the per-user and the __global__ buckets', () => {
    ctrl.incrementUsage('user1', {
      inputTokens: 10,
      outputTokens: 5,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
    });
    expect(BedrockDailyUsage.increment).toHaveBeenCalledWith(
      'user1',
      expect.any(String),
      expect.objectContaining({ inputTokens: 10, outputTokens: 5 }),
    );
    expect(BedrockDailyUsage.increment).toHaveBeenCalledWith(
      '__global__',
      expect.any(String),
      expect.objectContaining({ inputTokens: 10, outputTokens: 5 }),
    );
  });
});
