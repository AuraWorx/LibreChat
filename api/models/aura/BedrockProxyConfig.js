'use strict';

const mongoose = require('mongoose');

const limitsSchema = new mongoose.Schema({
  maxOutputTokensPerRequest: { type: Number, default: null },
  dailyInputTokens:          { type: Number, default: null },
  dailyOutputTokens:         { type: Number, default: null },
  dailyCacheWriteTokens:     { type: Number, default: null },
}, { _id: false });

const schema = new mongoose.Schema({
  _id:          { type: String, default: 'default' },
  limits:       { type: limitsSchema, default: () => ({}) },
  allowedModels: [String],
  updatedAt:    { type: Date },
  updatedBy:    { type: String },
}, { collection: 'bedrock_proxy_config' });

module.exports = mongoose.models.BedrockProxyConfig || mongoose.model('BedrockProxyConfig', schema);
