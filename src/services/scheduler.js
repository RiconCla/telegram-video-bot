const cron = require('node-cron');
const config = require('../../config/config');
const { log } = require('../utils/logger');
const { getStats, resetStats } = require('../utils/analytics');
const { runHealthcheck } = require('./tiktokHealthcheck');
const { getPendingUsers, removePending, markPending } = require('../utils/pendingSubscriptions');
const subscriptionCache = require('../utils/subscriptionCache');
const { Markup } = require('telegraf');

let bot = null;

function escapeMarkdown(text) {
    return String(text).replace(/[_*`\[]/g, '\\$&');
}

// Проверка подписки пользователя по userId (без ctx)
async function checkUserSubscription(userId, telegram) {
    const tg = telegram || (bot && bot.telegram);
    if (!config.CHECK_SUBSCRIPTION || !tg) return null;

    const cached = subscriptionCache.get(userId);
    if (cached !== undefined) return cached;

    try {
        const member = await tg.getChatMember(config.REQUIRED_CHANNEL, userId);
        const result = ['creator', 'administrator', 'member'].includes(member.status);
        subscriptionCache.set(userId, result);
        return result;
    } catch (error) {
        log('error', `Subscription check error for user ${userId}: ${error.message}`);
        return null;
    }
}

// Форматирование отчёта
async function formatReport(stats, telegram) {
    const { period, activeUsers, totalUsers, userList } = stats;

    let periodName;
    switch (period) {
        case 'daily':
            periodName = '📅 за сегодня';
            break;
        case 'weekly':
            periodName = '📅 за неделю';
            break;
        case 'monthly':
            periodName = '📅 за месяц';
            break;
    }

    // Проверяем подписку пользователей последовательно (избегаем rate limit)
    const subscriptionStatuses = new Map();
    if (config.CHECK_SUBSCRIPTION && userList.length > 0) {
        for (const user of userList) {
            const subscribed = await checkUserSubscription(user.userId, telegram);
            subscriptionStatuses.set(user.userId, subscribed);
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    let message = `📊 *Статистика бота ${periodName}*\n\n`;
    message += `👥 Активных пользователей: *${activeUsers}*\n`;
    message += `🔢 Всего пользователей: *${totalUsers}*\n\n`;

    if (userList.length > 0) {
        message += `📋 *Список пользователей:*\n`;
        userList.forEach((user, index) => {
            let userLink;
            if (user.userId) {
                const displayName = (user.username && user.username !== 'Unknown')
                    ? `@${user.username}`
                    : `User ${user.userId}`;
                userLink = `[${displayName}](tg://user?id=${user.userId})`;
            } else if (user.username && user.username !== 'Unknown') {
                userLink = `@${escapeMarkdown(user.username)}`;
            } else {
                userLink = `User ${index + 1}`;
            }

            let subLabel = '';
            if (subscriptionStatuses.has(user.userId)) {
                const status = subscriptionStatuses.get(user.userId);
                subLabel = status === true ? ' ✅' : status === false ? ' ❌' : ' ❓';
            }

            message += `${index + 1}. ${userLink} — ${user.requests} запросов${subLabel}\n`;
        });
    } else {
        message += `ℹ️ За этот период активности не было.`;
    }

    message += `\n🕐 Отчёт сформирован: ${new Date().toLocaleString('ru-RU', { timeZone: config.REPORT_TIMEZONE })}`;

    return message;
}

// Отправка напоминаний о подписке
async function sendSubscriptionReminders() {
    if (!bot || !config.CHECK_SUBSCRIPTION) return;

    const pendingUsers = getPendingUsers();
    const now = new Date();
    const intervalMs = config.SUBSCRIPTION_REMINDER_DAYS * 24 * 60 * 60 * 1000;
    let sent = 0;

    for (const { userId, lastReminder, lang } of pendingUsers) {
        if (now - lastReminder < intervalMs) continue;

        // Проверяем, может пользователь уже подписался
        const subscribed = await checkUserSubscription(userId);
        if (subscribed) {
            removePending(userId);
            log('info', `User subscribed since last check, removed from pending`, userId);
            continue;
        }

        const locale = lang === 'ru' ? require('../locales/ru') : require('../locales/en');
        try {
            await bot.telegram.sendMessage(userId, locale.SUBSCRIPTION_REMINDER, {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: locale.SUBSCRIBE_BUTTON, url: `https://t.me/${config.REQUIRED_CHANNEL.replace('@', '')}` }],
                        [{ text: locale.CHECK_SUBSCRIPTION_BUTTON, callback_data: 'check_subscription' }]
                    ]
                }
            });
            markPending(userId, lang); // обновляем lastReminder
            sent++;
            log('info', `Subscription reminder sent`, userId);
        } catch (e) {
            if (e.response?.error_code === 403) {
                // Пользователь заблокировал бота
                removePending(userId);
                log('info', `User blocked bot, removed from pending`, userId);
            } else {
                log('error', `Failed to send reminder: ${e.message}`, userId);
            }
        }
    }

    log('info', `Subscription reminders: ${sent} sent, ${pendingUsers.length} total pending`);
}

// Отправка отчёта администратору
async function sendReport(period) {
    if (!bot || !config.ADMIN_ID) {
        log('warning', 'Cannot send report: bot or ADMIN_ID not configured');
        return;
    }

    try {
        const stats = getStats(period);
        const message = await formatReport(stats, bot.telegram);

        await bot.telegram.sendMessage(config.ADMIN_ID, message, { parse_mode: 'Markdown' });
        log('success', `Report sent to admin (${config.ADMIN_ID}) for period: ${period}`);

        // Сбрасываем статистику после отправки отчёта
        resetStats(period);

    } catch (error) {
        log('error', `Failed to send report: ${error.message}`);
    }
}

// Парсинг времени из формата "ЧЧ:ММ"
function parseTime(timeString) {
    const [hours, minutes] = timeString.split(':').map(Number);
    return { hours, minutes };
}

// Инициализация планировщика
function initScheduler(botInstance) {
    bot = botInstance;

    if (!config.ADMIN_ID) {
        log('warning', 'ADMIN_ID not configured. Statistics reports are disabled.');
        return;
    }

    const { hours, minutes } = parseTime(config.REPORT_TIME);
    let cronExpression;

    // Определяем cron выражение в зависимости от периодичности
    switch (config.REPORT_FREQUENCY) {
        case 'daily':
            cronExpression = `${minutes} ${hours} * * *`;
            break;
        case 'weekly':
            cronExpression = `${minutes} ${hours} * * 1`;
            break;
        case 'monthly':
            cronExpression = `${minutes} ${hours} 1 * *`;
            break;
        default:
            log('error', `Invalid REPORT_FREQUENCY: ${config.REPORT_FREQUENCY}`);
            return;
    }

    log('info', `Scheduling reports: ${config.REPORT_FREQUENCY} at ${config.REPORT_TIME} ${config.REPORT_TIMEZONE}`);
    log('info', `Cron expression: ${cronExpression}`);

    // Создаём задачу статистики
    cron.schedule(cronExpression, () => {
        log('info', `Sending ${config.REPORT_FREQUENCY} report...`);
        sendReport(config.REPORT_FREQUENCY);
    }, {
        scheduled: true,
        timezone: config.REPORT_TIMEZONE
    });

    log('success', `Report scheduler initialized successfully!`);

    // Планируем проверку TikTok API каждые 4 часа
    cron.schedule('0 */4 * * *', () => {
        log('info', 'Running scheduled TikTok API healthcheck...');
        runHealthcheck(bot);
    }, {
        scheduled: true,
        timezone: config.REPORT_TIMEZONE
    });

    log('success', 'TikTok healthcheck scheduler initialized (every 4 hours)');

    // Напоминание о подписке — каждый день в 12:00
    if (config.CHECK_SUBSCRIPTION && config.SUBSCRIPTION_REMINDER_DAYS > 0) {
        cron.schedule('0 12 * * *', () => {
            log('info', 'Running subscription reminder check...');
            sendSubscriptionReminders();
        }, {
            scheduled: true,
            timezone: config.REPORT_TIMEZONE
        });
        log('success', `Subscription reminder scheduler initialized (every ${config.SUBSCRIPTION_REMINDER_DAYS} days)`);
    }

    // Запускаем первую проверку через 1 минуту после старта
    setTimeout(() => {
        log('info', 'Running initial TikTok API healthcheck...');
        runHealthcheck(bot);
    }, 60000);
}

// Отправка отчёта по команде (для тестирования)
async function sendManualReport(ctx, period = 'daily') {
    const userId = ctx.from.id.toString();

    // Проверяем, является ли пользователь администратором
    if (config.ADMIN_ID && userId !== config.ADMIN_ID.toString()) {
        await ctx.reply('❌ У вас нет прав для просмотра статистики.');
        return;
    }

    try {
        const stats = getStats(period);
        const message = await formatReport(stats, ctx.telegram);
        await ctx.reply(message, { parse_mode: 'Markdown' });
    } catch (error) {
        log('error', `Failed to send manual report: ${error.message}`);
        await ctx.reply('❌ Ошибка при формировании отчёта.');
    }
}

module.exports = {
    initScheduler,
    sendManualReport
};
