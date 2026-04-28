/**
 * Очередь подтверждений форварда. Между скачиванием и решением пользователя
 * («Да/Нет») мы держим файлы в shared volume, чтобы они пережили
 * штатный auto-cleanup временных файлов бота.
 *
 * Lifecycle:
 *   1. handleUrl → prepareBatch(): копируем файлы в /data/ingest/<batchId>/,
 *      создаём запись в in-memory store. Возвращаем token = batchId.
 *   2. user нажимает кнопку →
 *        Yes → confirm(token): забираем запись, POSTим в autoposter.
 *        No  → discard(token): удаляем запись и временную папку.
 *   3. Если пользователь не нажал в течение TTL (1ч) — записи протухают
 *      и `cleanup_orphan_ingest` в autoposter подберёт файлы через 24ч.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { log } = require('../utils/logger');
const config = require('../../config/config');

const TTL_MS = 60 * 60 * 1000; // 1 час
const _store = new Map(); // batchId → entry

function isEnabled() {
    return Boolean(
        config.AUTOPOSTER_URL && config.INGEST_SECRET && config.FORWARD_USER_ID,
    );
}

/**
 * @param {Object} opts
 * @param {number|string} opts.userId
 * @param {string} opts.sourceUrl
 * @param {Array<{path:string, kind:'photo'|'video'}>} opts.items
 * @returns {string|null} batchId (используется как token) или null если no-op
 */
function prepareBatch({ userId, sourceUrl, items }) {
    if (!isEnabled()) return null;
    if (String(userId) !== String(config.FORWARD_USER_ID)) return null;
    if (!Array.isArray(items) || items.length === 0) return null;

    const sharedDir = config.SHARED_INGEST_DIR || '/data/ingest';
    const batchId = crypto.randomBytes(6).toString('hex');
    const targetDir = path.join(sharedDir, batchId);

    try {
        fs.mkdirSync(targetDir, { recursive: true });
    } catch (e) {
        log('error', `forwardQueue.mkdir ${targetDir}: ${e.message}`, userId);
        return null;
    }

    const files = [];
    for (const item of items) {
        try {
            if (!fs.existsSync(item.path)) {
                log('warning', `forwardQueue: source gone ${item.path}`, userId);
                continue;
            }
            const filename = path.basename(item.path);
            const dst = path.join(targetDir, filename);
            fs.copyFileSync(item.path, dst);
            files.push({ path: `${batchId}/${filename}`, kind: item.kind });
        } catch (e) {
            log('error', `forwardQueue.copy ${item.path}: ${e.message}`, userId);
        }
    }

    if (files.length === 0) {
        _safeRm(targetDir);
        return null;
    }

    _store.set(batchId, {
        userId: Number(userId),
        sourceUrl,
        files,
        targetDir,
        ts: Date.now(),
    });
    _gc();
    return batchId;
}

function confirm(token) {
    const entry = _store.get(token);
    if (!entry) return null;
    _store.delete(token);
    return entry; // caller теперь делает POST
}

function discard(token) {
    const entry = _store.get(token);
    if (!entry) return false;
    _store.delete(token);
    _safeRm(entry.targetDir);
    return true;
}

function _gc() {
    const now = Date.now();
    for (const [k, v] of _store) {
        if (now - v.ts > TTL_MS) {
            _store.delete(k);
            _safeRm(v.targetDir);
        }
    }
}

function _safeRm(p) {
    try {
        fs.rmSync(p, { recursive: true, force: true });
    } catch {
        /* ignore */
    }
}

module.exports = { prepareBatch, confirm, discard, isEnabled };
