// Кеш подписок: userId -> { subscribed: boolean, cachedAt: number }
const cache = new Map();
const TTL = 12 * 60 * 60 * 1000; // 12 часов

function get(userId) {
    const entry = cache.get(String(userId));
    if (entry && (Date.now() - entry.cachedAt) < TTL) {
        return entry.subscribed;
    }
    return undefined;
}

function set(userId, subscribed) {
    cache.set(String(userId), { subscribed, cachedAt: Date.now() });
}

module.exports = { get, set };
