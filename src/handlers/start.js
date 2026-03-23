const { Markup } = require('telegraf');
const { log } = require('../utils/logger');
const { checkSubscription } = require('../middleware/subscription');
const { getLocale, setLanguage, isUserActive, setUserActive } = require('../utils/i18n');
const en = require('../locales/en');
const config = require('../../config/config');

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

    const isSubscribed = await checkSubscription(ctx);
    if (!isSubscribed) {
        log('warning', 'User not subscribed to required channel', userId);
        await ctx.reply(
            messages.SUBSCRIPTION_REQUIRED,
            Markup.inlineKeyboard([
                [Markup.button.url('📢 Subscribe', `https://t.me/${config.REQUIRED_CHANNEL.replace('@', '')}`)],
                [Markup.button.callback('✅ I subscribed', 'check_subscription')]
            ])
        );
        return;
    }

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
}

// ─────────────────────────────────────────────
// Кнопка «Запуск бота» — запасной обработчик
// (на случай если у кого-то осталась старая клавиатура)
// ─────────────────────────────────────────────
async function handleLaunchButton(ctx) {
    const userId = ctx.from.id;
    const messages = getLocale(userId);

    log('info', 'User clicked launch button (legacy)', userId);

    const isSubscribed = await checkSubscription(ctx);

    if (!isSubscribed) {
        log('warning', 'User not subscribed to required channel', userId);
        await ctx.reply(
            messages.SUBSCRIPTION_REQUIRED,
            Markup.inlineKeyboard([
                [Markup.button.url('📢 Subscribe', `https://t.me/${config.REQUIRED_CHANNEL.replace('@', '')}`)],
                [Markup.button.callback('✅ I subscribed', 'check_subscription')]
            ])
        );
        return;
    }

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

    const isSubscribed = await checkSubscription(ctx);

    if (!isSubscribed) {
        log('warning', 'Subscription verification failed', userId);
        await ctx.reply(messages.SUBSCRIPTION_FAILED);
        return;
    }

    setUserActive(userId);
    log('success', 'Subscription verified successfully', userId);

    await ctx.reply(messages.BOT_ACTIVATED, Markup.removeKeyboard());
}

module.exports = {
    handleStart,
    handleLanguageSelectStart,
    handleLanguageSelect,
    handleLaunchButton,
    handleCheckSubscription
};
