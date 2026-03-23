const { Markup } = require('telegraf');
const { log } = require('../utils/logger');
const { checkSubscription } = require('../middleware/subscription');
const { getLocale, setLanguage, hasLanguage, setUserActive } = require('../utils/i18n');
const en = require('../locales/en');
const config = require('../../config/config');

// ─────────────────────────────────────────────
// /start — экран выбора языка или приветствие
// ─────────────────────────────────────────────
async function handleStart(ctx) {
    const userId = ctx.from.id;
    const username = ctx.from.username || ctx.from.first_name;

    log('info', `User started bot: @${username}`, userId);

    if (hasLanguage(userId)) {
        // Возвращающийся пользователь — пропускаем выбор языка
        setUserActive(userId);
        const messages = getLocale(userId);
        await ctx.reply(messages.WELCOME_BACK, Markup.removeKeyboard());
        return;
    }

    // Новый пользователь — показываем выбор языка (всегда на английском)
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
// Callback: выбор языка (из /start или /lang)
// ─────────────────────────────────────────────
async function handleLanguageSelect(ctx) {
    const userId = ctx.from.id;
    const lang = ctx.callbackQuery.data === 'lang_en' ? 'en' : 'ru';

    // Определяем контекст ДО сохранения языка:
    // если языка ещё нет — пришли из /start (первый раз)
    const isFirstTime = !hasLanguage(userId);

    await ctx.answerCbQuery();
    setLanguage(userId, lang);

    const messages = getLocale(userId);
    log('info', `User selected language: ${lang}`, userId);

    if (isFirstTime) {
        // Первый выбор языка — показываем приветствие + кнопку запуска
        await ctx.editMessageText(messages.LANGUAGE_SELECTED);
        await ctx.reply(
            messages.WELCOME_NEW,
            Markup.keyboard([
                [messages.LAUNCH_BUTTON]
            ]).resize()
        );
    } else {
        // Смена языка в процессе работы
        await ctx.editMessageText(messages.LANG_CHANGED);
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

    setUserActive(userId);
    log('info', 'User activated bot', userId);

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

    setUserActive(userId);
    log('success', 'Subscription verified successfully', userId);

    await ctx.reply(
        messages.BOT_ACTIVATED,
        Markup.removeKeyboard()
    );
}

module.exports = {
    handleStart,
    handleLanguageSelect,
    handleLaunchButton,
    handleCheckSubscription
};
