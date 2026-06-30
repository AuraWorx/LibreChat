'use strict';

const mongoose = require('mongoose');

const dailyLimitsSchema = new mongoose.Schema(
  {
    dailyInputTokens: { type: Number, default: null },
    dailyOutputTokens: { type: Number, default: null },
    dailyCacheWriteTokens: { type: Number, default: null },
  },
  { _id: false },
);

const schema = new mongoose.Schema(
  {
    _id: { type: String, default: 'default' },
    // Hard ceiling applied per-request to every key (most restrictive of key, global, env)
    maxOutputTokensPerRequest: { type: Number, default: null },
    // Per-key defaults: stamped onto new keys at creation; fallback for keys with no explicit daily limits
    keyDefaults: { type: dailyLimitsSchema, default: () => ({}) },
    // Org aggregate budget: total tokens/day across all keys combined
    orgBudget: { type: dailyLimitsSchema, default: () => ({}) },
    allowedModels: [String],
    updatedAt: { type: Date },
    updatedBy: { type: String },
  },
  { collection: 'bedrock_proxy_config' },
);

module.exports = mongoose.models.BedrockProxyConfig || mongoose.model('BedrockProxyConfig', schema);
