const { Markup } = require('telegraf');
const { log } = require('../utils/logger');
const {
    checkSubscription,
    buildSubscriptionKeyboard,
    pickRequiredText,
    pickFailedText
} = require('../middleware/subscription');
const {
    getLocale,
    setLanguage,
    getUserLanguage,
    isUserActive,
    setUserActive,
    clearUserActive
} = require('../utils/i18n');
const { markPending, removePending } = require('../utils/pendingSubscriptions');
const subscriptionCache = require('../utils/subscriptionCache');
const en = require('../locales/en');

// ─────────────────────────────────────────────
// /start — всегда показывает выбор языка
// ─────────────────────────────────────────────
async function handleStart(ctx) {
    const userId = ctx.from.id;
    const username = ctx.from.username || ctx.from.first_name;

    log('info', `User started bot: @${username}`, userId);

    // Всегда показываем выбор языка (нейтральный английский текст)
    // Кнопки /start используют lang_en_start/lang_ru_start — отдельные от /lang
    await ctx.reply(
        en.LANGUAGE_SELECT,
        Markup.inlineKeyboard([
            [
                Markup.button.callback('🇬🇧 English', 'lang_en_start'),
                Markup.button.callback('🇷🇺 Русский', 'lang_ru_start')
            ]
        ])
    );
}

// ─────────────────────────────────────────────
// Callback: выбор языка из /start
// Активирует бота сразу — без кнопки «Запуск»
// ─────────────────────────────────────────────
async function handleLanguageSelectStart(ctx) {
    const userId = ctx.from.id;
    const lang = ctx.callbackQuery.data === 'lang_en_start' ? 'en' : 'ru';

    await ctx.answerCbQuery();
    setLanguage(userId, lang);

    const messages = getLocale(userId);
    log('info', `User selected language: ${lang}`, userId);

    if (isUserActive(userId)) {
        // Возвращающийся пользователь — сразу в работу
        await ctx.editMessageText(messages.LANGUAGE_SELECTED);
        await ctx.reply(messages.WELCOME_BACK, Markup.removeKeyboard());
        return;
    }

    // Новый пользователь — проверка подписки (без промежуточной кнопки «Запуск»)
    await ctx.editMessageText(messages.LANGUAGE_SELECTED);

    const { ok, missing } = await checkSubscription(ctx);
    if (!ok) {
        log('warning', 'User not subscribed to required channel(s)', userId);
        markPending(userId, lang);
        await ctx.reply(
            pickRequiredText(messages, missing),
            buildSubscriptionKeyboard(messages, missing)
        );
        return;
    }

    removePending(userId);
    setUserActive(userId);
    log('info', 'User activated bot', userId);
    await ctx.reply(messages.BOT_ACTIVATED, Markup.removeKeyboard());
}

// ─────────────────────────────────────────────
// Callback: выбор языка из /lang или кнопки «Сменить язык»
// Только меняет язык — без welcome-сообщений
// ─────────────────────────────────────────────
async function handleLanguageSelect(ctx) {
    const userId = ctx.from.id;
    const lang = ctx.callbackQuery.data === 'lang_en' ? 'en' : 'ru';

    // Сначала меняем язык — это не должно зависеть от Telegram API
    setLanguage(userId, lang);
    const messages = getLocale(userId);
    log('info', `User changed language to: ${lang}`, userId);

    // answerCbQuery — некритичный UI-вызов, ошибка не должна прерывать смену языка
    try {
        await ctx.answerCbQuery();
    } catch (e) {
        log('warning', `answerCbQuery failed during lang switch: ${e.message}`, userId);
    }

    // editMessageText может вернуть "message is not modified" — это не ошибка
    try {
        await ctx.editMessageText(messages.LANG_CHANGED);
    } catch (e) {
        if (!e.message?.includes('message is not modified')) {
            log('warning', `editMessageText failed during lang switch: ${e.message}`, userId);
        }
    }

    // При переключении на ru — проверяем подписку с учётом нового языка.
    // Если 2-й канал требуется и не подписан — блокируем как при первом старте.
    if (lang === 'ru') {
        const { ok, missing } = await checkSubscription(ctx);
        if (!ok) {
            log('warning', 'User switched to ru but not subscribed to required channel(s)', userId);
            clearUserActive(userId);
            markPending(userId, 'ru');
            await ctx.reply(
                pickRequiredText(messages, missing),
                buildSubscriptionKeyboard(messages, missing)
            );
            return;
        }
    }

    await ctx.reply(messages.SEND_NEW_LINK);
}

// ─────────────────────────────────────────────
// Кнопка «Запуск бота» — запасной обработчик
// (на случай если у кого-то осталась старая клавиатура)
// ─────────────────────────────────────────────
async function handleLaunchButton(ctx) {
    const userId = ctx.from.id;
    const messages = getLocale(userId);

    log('info', 'User clicked launch button (legacy)', userId);

    const { ok, missing } = await checkSubscription(ctx);

    if (!ok) {
        log('warning', 'User not subscribed to required channel(s)', userId);
        markPending(userId, getUserLanguage(userId));
        await ctx.reply(
            pickRequiredText(messages, missing),
            buildSubscriptionKeyboard(messages, missing)
        );
        return;
    }

    removePending(userId);
    setUserActive(userId);
    log('info', 'User activated bot via legacy button', userId);

    await ctx.reply(messages.BOT_ACTIVATED, Markup.removeKeyboard());
}

// ─────────────────────────────────────────────
// Callback: проверка подписки
// ─────────────────────────────────────────────
async function handleCheckSubscription(ctx) {
    const userId = ctx.from.id;
    const messages = getLocale(userId);

    await ctx.answerCbQuery();
    log('info', 'User clicked "I subscribed" button', userId);

    subscriptionCache.invalidate(userId);
    const { ok, missing } = await checkSubscription(ctx);

    if (!ok) {
        log('warning', 'Subscription verification failed', userId);
        markPending(userId, getUserLanguage(userId));
        await ctx.reply(
            pickFailedText(messages, missing),
            buildSubscriptionKeyboard(messages, missing)
        );
        return;
    }

    removePending(userId);
    setUserActive(userId);
    log('success', 'Subscription verified successfully', userId);

    try {
        await ctx.deleteMessage();
    } catch (e) {
        log('warning', `Failed to delete subscription prompt: ${e.message}`, userId);
    }

    await ctx.reply(messages.BOT_ACTIVATED, Markup.removeKeyboard());
}

module.exports = {
    handleStart,
    handleLanguageSelectStart,
    handleLanguageSelect,
    handleLaunchButton,
    handleCheckSubscription
};
