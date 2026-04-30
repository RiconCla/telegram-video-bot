const fs = require('fs');
const path = require('path');
const { log } = require('./logger');

// Кеш подписок: ключ "${userId}:${channelId}" -> { subscribed: boolean, cachedAt: number }
const cache = new Map();
const TTL = 12 * 60 * 60 * 1000; // 12 часов

function cacheKey(userId, channelId) {
    return `${String(userId)}:${String(channelId)}`;
}

// Перманентно невалидные пользователи (PARTICIPANT_ID_INVALID и т.п.) — не дёргаем API
const INVALID_FILE = path.resolve(__dirname, '../../data/invalid-subscription-users.json');
let invalidUsers = new Set();

try {
    if (fs.existsSync(INVALID_FILE)) {
        const arr = JSON.parse(fs.readFileSync(INVALID_FILE, 'utf-8'));
        invalidUsers = new Set(arr.map(String));
    }
} catch (e) {
    log('error', `Failed to load invalid-subscription users: ${e.message}`);
}

let saveTimer = null;

function saveInvalid() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        try {
            const dir = path.dirname(INVALID_FILE);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(INVALID_FILE, JSON.stringify([...invalidUsers], null, 2), 'utf-8');
        } catch (e) {
            log('error', `Failed to save invalid-subscription users: ${e.message}`);
        }
    }, 1000);
}

function get(userId, channelId) {
    const entry = cache.get(cacheKey(userId, channelId));
    if (entry && (Date.now() - entry.cachedAt) < TTL) {
        return entry.subscribed;
    }
    return undefined;
}

function set(userId, channelId, subscribed) {
    cache.set(cacheKey(userId, channelId), { subscribed, cachedAt: Date.now() });
}

function invalidate(userId) {
    const prefix = `${String(userId)}:`;
    for (const key of cache.keys()) {
        if (key.startsWith(prefix)) cache.delete(key);
    }
}

function isInvalid(userId) {
    return invalidUsers.has(String(userId));
}

function markInvalid(userId) {
    const key = String(userId);
    if (!invalidUsers.has(key)) {
        invalidUsers.add(key);
        saveInvalid();
    }
}

module.exports = { get, set, invalidate, isInvalid, markInvalid };
