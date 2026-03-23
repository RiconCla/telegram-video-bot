const config = require('../../config/config');
const { log } = require('../utils/logger');
const { getLocale } = require('../utils/i18n');

// Хранилище последних запросов пользователей
const userLastRequest = new Map();

// Команды и callback-ы, не подпадающие под rate limit
const BYPASS_COMMANDS = new Set(['/start', '/lang']);
const BYPASS_CALLBACKS = new Set([
    'lang_en_start', 'lang_ru_start',
    'lang_en', 'lang_ru',
    'lang_change_menu', 'lang_no_ask',
    'check_subscription'
]);

async function rateLimitMiddleware(ctx, next) {
    const userId = ctx.from?.id;
    if (!userId) return next();

    const text = ctx.message?.text;
    const callbackData = ctx.callbackQuery?.data;

    // Пропускаем служебные команды и callback-ы
    if (
        (text && BYPASS_COMMANDS.has(text.split(' ')[0])) ||
        (callbackData && BYPASS_CALLBACKS.has(callbackData))
    ) {
        return next();
    }

    const lastRequest = userLastRequest.get(userId);
    const now = Date.now();

    if (lastRequest && (now - lastRequest) < config.RATE_LIMIT) {
        const waitTime = Math.ceil((config.RATE_LIMIT - (now - lastRequest)) / 1000);
        log('warning', `Rate limit exceeded. Wait ${waitTime}s`, userId);
        const messages = getLocale(userId);
        await ctx.reply(messages.rateLimit(waitTime));
        return;
    }

    userLastRequest.set(userId, now);
    return next();
}

// Периодическая очистка устаревших записей (каждую минуту)
setInterval(() => {
    const cutoff = Date.now() - config.RATE_LIMIT * 10;
    for (const [userId, timestamp] of userLastRequest) {
        if (timestamp < cutoff) {
            userLastRequest.delete(userId);
        }
    }
}, 60 * 1000);

module.exports = { rateLimitMiddleware };
