'use strict';

const mongoose = require('mongoose');
const crypto = require('crypto');

const schema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, maxlength: 100 },
    hash: { type: String, required: true },
    lastFour: { type: String, required: true, maxlength: 4 },
    allowedModels: { type: [String], default: null },
    active: { type: Boolean, default: true, index: true },
    createdAt: { type: Date, default: Date.now, index: true },
    lastUsedAt: { type: Date, default: null },
  },
  { collection: 'bedrock_api_keys' },
);

schema.index({ hash: 1 }, { unique: true });
schema.index({ userId: 1, createdAt: -1 });

schema.statics.generateToken = function () {
  const token = crypto.randomBytes(30).toString('base64url');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const lastFour = token.slice(-4);
  return { token, hash, lastFour };
};

schema.statics.findByHash = function (hash) {
  return this.findOne({ hash, active: true });
};

schema.statics.softDelete = function (id, userId) {
  return this.updateOne({ _id: id, userId }, { $set: { active: false } });
};

module.exports = mongoose.model('BedrockApiKey', schema);
