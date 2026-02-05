const config = require('../../config/config');
const { log } = require('../utils/logger');
const messages = require('../utils/messages');

// Хранилище последних запросов пользователей
const userLastRequest = new Map();

async function rateLimitMiddleware(ctx, next) {
    const userId = ctx.from?.id;
    if (!userId) return next();

    // Пропускаем проверку для команды /start
    if (ctx.message?.text === '/start') {
        return next();
    }

    const lastRequest = userLastRequest.get(userId);
    const now = Date.now();

    if (lastRequest && (now - lastRequest) < config.RATE_LIMIT) {
        const waitTime = Math.ceil((config.RATE_LIMIT - (now - lastRequest)) / 1000);
        log('warning', `Rate limit exceeded. Wait ${waitTime}s`, userId);
        await ctx.reply(messages.rateLimit(waitTime));
        return;
    }

    userLastRequest.set(userId, now);
    return next();
}

module.exports = { rateLimitMiddleware };
