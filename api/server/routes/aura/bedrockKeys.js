'use strict';

const express = require('express');
const { requireJwtAuth } = require('../../middleware');
const { createKey, listKeys, deleteKey } = require('../../controllers/aura/bedrockKeysController');

const router = express.Router();

router.post('/', requireJwtAuth, createKey);
router.get('/', requireJwtAuth, listKeys);
router.delete('/:id', requireJwtAuth, deleteKey);

module.exports = router;
