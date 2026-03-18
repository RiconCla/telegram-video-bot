const { Markup } = require('telegraf');
const { log } = require('../utils/logger');
const { checkSubscription } = require('../middleware/subscription');
const { getLocale, setLanguage, hasLanguage } = require('../utils/i18n');
const en = require('../locales/en');
const config = require('../../config/config');

// Хранилище состояний пользователей
const userStates = new Map();

// ─────────────────────────────────────────────
// /start — экран выбора языка
// ─────────────────────────────────────────────
async function handleStart(ctx) {
    const userId = ctx.from.id;
    const username = ctx.from.username || ctx.from.first_name;

    log('info', `User started bot: @${username}`, userId);

    // Всегда показываем экран выбора языка при /start
    // Приветствие всегда на английском (нейтральный язык по умолчанию)
    await ctx.reply(
        en.LANGUAGE_SELECT,
        Markup.inlineKeyboard([
            [
                Markup.button.callback('🇬🇧 English', 'lang_en'),
                Markup.button.callback('🇷🇺 Русский', 'lang_ru')
            ]
        ])
    );
}

// ─────────────────────────────────────────────
// Callback: выбор языка
// ─────────────────────────────────────────────
async function handleLanguageSelect(ctx) {
    const userId = ctx.from.id;
    const lang = ctx.callbackQuery.data === 'lang_en' ? 'en' : 'ru';

    await ctx.answerCbQuery();
    setLanguage(userId, lang);

    const messages = getLocale(userId);
    log('info', `User selected language: ${lang}`, userId);

    // После выбора языка — сразу показываем приветствие нового/вернувшегося пользователя
    const isNew = !userStates.has(userId);

    if (isNew) {
        await ctx.editMessageText(messages.LANGUAGE_SELECTED);
        await ctx.reply(
            messages.WELCOME_NEW,
            Markup.keyboard([
                [messages.LAUNCH_BUTTON]
            ]).resize()
        );
    } else {
        await ctx.editMessageText(messages.LANGUAGE_SELECTED);
        await ctx.reply(
            messages.WELCOME_BACK,
            Markup.removeKeyboard()
        );
    }
}

// ─────────────────────────────────────────────
// Кнопка "Запуск бота" / "Launch bot"
// ─────────────────────────────────────────────
async function handleLaunchButton(ctx) {
    const userId = ctx.from.id;
    const messages = getLocale(userId);

    log('info', 'User clicked launch button', userId);

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

    userStates.set(userId, 'active');
    log('info', 'User state changed to: active', userId);

    await ctx.reply(
        messages.BOT_ACTIVATED,
        Markup.removeKeyboard()
    );
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

    userStates.set(userId, 'active');
    log('success', 'Subscription verified successfully', userId);

    await ctx.reply(
        messages.BOT_ACTIVATED,
        Markup.removeKeyboard()
    );
}

// Получить состояние пользователя
function getUserState(userId) {
    return userStates.get(userId);
}

module.exports = {
    handleStart,
    handleLanguageSelect,
    handleLaunchButton,
    handleCheckSubscription,
    getUserState
};
