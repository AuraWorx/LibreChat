'use strict';

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const BedrockDailyUsage = require('./BedrockDailyUsage');

const DATE = '2026-06-09';
let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

afterEach(async () => {
  await BedrockDailyUsage.deleteMany({});
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe('BedrockDailyUsage.increment', () => {
  it('upserts a new daily doc with the supplied counters', async () => {
    await BedrockDailyUsage.increment('user1', DATE, {
      inputTokens: 100,
      outputTokens: 50,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
    });
    const doc = await BedrockDailyUsage.findOne({ userId: 'user1', date: DATE }).lean();
    expect(doc.inputTokens).toBe(100);
    expect(doc.outputTokens).toBe(50);
    expect(doc.cacheWriteTokens).toBe(0);
  });

  it('accumulates across multiple calls for the same user+date', async () => {
    await BedrockDailyUsage.increment('user1', DATE, { inputTokens: 100, outputTokens: 50 });
    await BedrockDailyUsage.increment('user1', DATE, { inputTokens: 30, outputTokens: 10 });
    const doc = await BedrockDailyUsage.findOne({ userId: 'user1', date: DATE }).lean();
    expect(doc.inputTokens).toBe(130);
    expect(doc.outputTokens).toBe(60);
  });

  it('keeps a single doc per user+date (unique index)', async () => {
    await BedrockDailyUsage.increment('user1', DATE, { inputTokens: 1 });
    await BedrockDailyUsage.increment('user1', DATE, { inputTokens: 1 });
    const count = await BedrockDailyUsage.countDocuments({ userId: 'user1', date: DATE });
    expect(count).toBe(1);
  });

  it('does not write when every counter is zero or absent', async () => {
    await BedrockDailyUsage.increment('user2', DATE, {
      inputTokens: 0,
      outputTokens: 0,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
    });
    const doc = await BedrockDailyUsage.findOne({ userId: 'user2', date: DATE });
    expect(doc).toBeNull();
  });

  it('increments cache counters independently of token counters', async () => {
    await BedrockDailyUsage.increment('user3', DATE, { cacheWriteTokens: 7, cacheReadTokens: 3 });
    const doc = await BedrockDailyUsage.findOne({ userId: 'user3', date: DATE }).lean();
    expect(doc.cacheWriteTokens).toBe(7);
    expect(doc.cacheReadTokens).toBe(3);
    expect(doc.inputTokens).toBe(0);
  });

  it('accepts the __global__ string sentinel as userId (Mixed type)', async () => {
    await BedrockDailyUsage.increment('__global__', DATE, { inputTokens: 500, outputTokens: 200 });
    const doc = await BedrockDailyUsage.findOne({ userId: '__global__', date: DATE }).lean();
    expect(doc.userId).toBe('__global__');
    expect(doc.inputTokens).toBe(500);
    expect(doc.outputTokens).toBe(200);
  });

  it('keeps per-user and __global__ buckets separate for the same date', async () => {
    await BedrockDailyUsage.increment('user4', DATE, { inputTokens: 10 });
    await BedrockDailyUsage.increment('__global__', DATE, { inputTokens: 10 });
    const user = await BedrockDailyUsage.findOne({ userId: 'user4', date: DATE }).lean();
    const global = await BedrockDailyUsage.findOne({ userId: '__global__', date: DATE }).lean();
    expect(user.inputTokens).toBe(10);
    expect(global.inputTokens).toBe(10);
  });
});
