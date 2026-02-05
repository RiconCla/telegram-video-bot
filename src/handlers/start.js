const { Markup } = require('telegraf');
const { log } = require('../utils/logger');
const { checkSubscription } = require('../middleware/subscription');
const messages = require('../utils/messages');
const config = require('../../config/config');

// Хранилище состояний пользователей
const userStates = new Map();

// Команда /start
async function handleStart(ctx) {
    const userId = ctx.from.id;
    const username = ctx.from.username || ctx.from.first_name;

    log('info', `User started bot: @${username}`, userId);

    const isNewUser = !userStates.has(userId);

    if (isNewUser) {
        await ctx.reply(
            messages.WELCOME_NEW,
            Markup.keyboard([
                ['🚀 Запуск бота']
            ]).resize()
        );
    } else {
        await ctx.reply(
            messages.WELCOME_BACK,
            Markup.removeKeyboard()
        );
    }
}

// Обработка кнопки "Запуск бота"
async function handleLaunchButton(ctx) {
    const userId = ctx.from.id;
    log('info', 'User clicked "Start bot" button', userId);

    const isSubscribed = await checkSubscription(ctx);

    if (!isSubscribed) {
        log('warning', 'User not subscribed to required channel', userId);
        await ctx.reply(
            messages.SUBSCRIPTION_REQUIRED,
            Markup.inlineKeyboard([
                [Markup.button.url('📢 Подписаться', `https://t.me/${config.REQUIRED_CHANNEL.replace('@', '')}`)],
                [Markup.button.callback('✅ Я подписался', 'check_subscription')]
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

// Обработка callback кнопки проверки подписки
async function handleCheckSubscription(ctx) {
    const userId = ctx.from.id;
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
    handleLaunchButton,
    handleCheckSubscription,
    getUserState
};
