'use strict';

const mongoose = require('mongoose');
const BedrockApiKey = require('../../../models/aura/BedrockApiKey');
const auditLogger = require('../../services/aura/auditLogger');

async function createKey(req, res) {
  try {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return res.status(400).json({ error: 'name is required' });
    }
    if (name.trim().length > 100) {
      return res.status(400).json({ error: 'name must be 100 characters or fewer' });
    }

    const userId = req.user.id;
    const existing = await BedrockApiKey.findOne({ userId, name: name.trim(), active: true });
    if (existing) {
      return res.status(409).json({ error: 'A key with this name already exists' });
    }

    const { token, hash, lastFour } = BedrockApiKey.generateToken();
    const doc = await BedrockApiKey.create({ userId, name: name.trim(), hash, lastFour });

    auditLogger.keyCreated({
      actor: { userId, via: 'settings_ui' },
      key: { id: doc._id.toString(), name: doc.name, lastFour },
      requestId: req.requestId ?? null,
    });

    return res.status(201).json({
      id: doc._id.toString(),
      name: doc.name,
      token,
      lastFour,
      createdAt: doc.createdAt,
    });
  } catch (err) {
    return res.status(500).json({ error: 'internal_error' });
  }
}

async function listKeys(req, res) {
  try {
    const userId = req.user.id;
    const raw = await BedrockApiKey.find({ userId, active: true })
      .sort({ createdAt: -1 })
      .lean();

    const keys = raw.map(({ _id, name, lastFour, createdAt, lastUsedAt, active }) => ({
      id: _id.toString(),
      name,
      lastFour,
      createdAt,
      lastUsedAt,
      active,
    }));

    return res.json({ keys });
  } catch (err) {
    return res.status(500).json({ error: 'internal_error' });
  }
}

async function deleteKey(req, res) {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ error: 'not_found' });
    }

    const doc = await BedrockApiKey.findOne({ _id: id, userId, active: true });
    if (!doc) {
      return res.status(404).json({ error: 'not_found' });
    }

    await BedrockApiKey.deleteOne({ _id: id, userId });

    auditLogger.keyDeleted({
      actor: { userId, via: 'settings_ui' },
      key: { id: doc._id.toString(), name: doc.name, lastFour: doc.lastFour },
      requestId: req.requestId ?? null,
    });

    return res.status(204).send();
  } catch (err) {
    return res.status(500).json({ error: 'internal_error' });
  }
}

module.exports = { createKey, listKeys, deleteKey };
