const { Markup } = require('telegraf');
const config = require('../../config/config');
const { log } = require('../utils/logger');
const subscriptionCache = require('../utils/subscriptionCache');
const { getUserLanguage } = require('../utils/i18n');

const ALLOWED_STATUSES = ['creator', 'administrator', 'member'];

// ─────────────────────────────────────────────
// Какие каналы требуются для конкретного языка
// ─────────────────────────────────────────────
function requiredChannelsForLang(lang) {
    const channels = [...config.REQUIRED_CHANNELS];
    if (lang === 'ru') channels.push(...config.REQUIRED_CHANNELS_RU);
    return channels;
}

// ─────────────────────────────────────────────
// Низкий уровень: проверка одного канала
// Возвращает true / false / null (null = нечего проверить)
// ─────────────────────────────────────────────
async function checkChannelSubscription(telegram, userId, channelId) {
    if (!channelId) return null;
    if (subscriptionCache.isInvalid(userId)) return null;

    const cached = subscriptionCache.get(userId, channelId);
    if (cached !== undefined) return cached;

    try {
        const member = await telegram.getChatMember(channelId, userId);
        const ok = ALLOWED_STATUSES.includes(member.status);
        subscriptionCache.set(userId, channelId, ok);
        return ok;
    } catch (error) {
        if (error.message && error.message.includes('PARTICIPANT_ID_INVALID')) {
            subscriptionCache.markInvalid(userId);
            log('warning', `User ${userId} marked as invalid (PARTICIPANT_ID_INVALID); future subscription checks skipped`);
            return null;
        }
        log('error', `Subscription check error for ${userId}@${channelId}: ${error.message}`);
        return false;
    }
}

// ─────────────────────────────────────────────
// Политика: проверка с учётом языка
// Возвращает { ok, missing }, где missing — список недостающих каналов
// ─────────────────────────────────────────────
async function checkSubscriptionForLang(telegram, userId, lang) {
    if (!config.CHECK_SUBSCRIPTION) return { ok: true, missing: [] };

    const channels = requiredChannelsForLang(lang);
    if (channels.length === 0) return { ok: true, missing: [] };

    const missing = [];
    for (const ch of channels) {
        const result = await checkChannelSubscription(telegram, userId, ch);
        if (result === false) missing.push(ch);
        // result === null — не считаем missing (либо канал не задан, либо invalid user)
    }
    log('info', `Subscription check for lang=${lang}: ${missing.length === 0 ? 'PASSED' : `MISSING ${missing.join(', ')}`}`, userId);
    return { ok: missing.length === 0, missing };
}

// ─────────────────────────────────────────────
// Высокий уровень: проверка через ctx
// ─────────────────────────────────────────────
async function checkSubscription(ctx) {
    const lang = getUserLanguage(ctx.from.id) || 'en';
    return checkSubscriptionForLang(ctx.telegram, ctx.from.id, lang);
}

// ─────────────────────────────────────────────
// UI helpers: построение клавиатуры и выбор текста
// ─────────────────────────────────────────────
function channelUrl(channel) {
    return `https://t.me/${String(channel).replace('@', '')}`;
}

function buildSubscriptionKeyboard(messages, missing) {
    const channels = (missing && missing.length > 0)
        ? missing
        : config.REQUIRED_CHANNELS;

    const rows = channels.map((ch, idx) => {
        const label = channels.length > 1
            ? `${messages.SUBSCRIBE_BUTTON} (${idx + 1})`
            : messages.SUBSCRIBE_BUTTON;
        return [Markup.button.url(label, channelUrl(ch))];
    });
    rows.push([Markup.button.callback(messages.CHECK_SUBSCRIPTION_BUTTON, 'check_subscription')]);
    return Markup.inlineKeyboard(rows);
}

function pickRequiredText(messages, missing) {
    return (missing && missing.length > 1 && messages.SUBSCRIPTION_REQUIRED_MULTI)
        ? messages.SUBSCRIPTION_REQUIRED_MULTI
        : messages.SUBSCRIPTION_REQUIRED;
}

function pickFailedText(messages, missing) {
    return (missing && missing.length > 1 && messages.SUBSCRIPTION_FAILED_MULTI)
        ? messages.SUBSCRIPTION_FAILED_MULTI
        : messages.SUBSCRIPTION_FAILED;
}

function pickReminderText(messages, missing) {
    return (missing && missing.length > 1 && messages.SUBSCRIPTION_REMINDER_MULTI)
        ? messages.SUBSCRIPTION_REMINDER_MULTI
        : messages.SUBSCRIPTION_REMINDER;
}

module.exports = {
    checkSubscription,
    checkSubscriptionForLang,
    checkChannelSubscription,
    buildSubscriptionKeyboard,
    pickRequiredText,
    pickFailedText,
    pickReminderText
};
