'use strict';

const mongoose = require('mongoose');

// Accumulates token usage per user per UTC day. Written fire-and-forget after
// each successful proxy call; read on the pre-call limit check.
const schema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.Mixed, required: true },
    date: { type: String, required: true }, // "2026-06-08" UTC
    inputTokens: { type: Number, default: 0 },
    outputTokens: { type: Number, default: 0 },
    cacheWriteTokens: { type: Number, default: 0 },
    cacheReadTokens: { type: Number, default: 0 },
  },
  { collection: 'bedrock_usage_daily' },
);

schema.index({ userId: 1, date: 1 }, { unique: true });

schema.statics.increment = function (userId, date, counters) {
  const inc = {};
  if (counters.inputTokens > 0) inc.inputTokens = counters.inputTokens;
  if (counters.outputTokens > 0) inc.outputTokens = counters.outputTokens;
  if (counters.cacheWriteTokens > 0) inc.cacheWriteTokens = counters.cacheWriteTokens;
  if (counters.cacheReadTokens > 0) inc.cacheReadTokens = counters.cacheReadTokens;
  if (!Object.keys(inc).length) return Promise.resolve();
  return this.findOneAndUpdate({ userId, date }, { $inc: inc }, { upsert: true });
};

module.exports = mongoose.model('BedrockDailyUsage', schema);
