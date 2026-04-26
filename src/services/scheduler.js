const cron = require('node-cron');
const config = require('../../config/config');
const { log } = require('../utils/logger');
const { getStats, resetStats, getAllUsersList } = require('../utils/analytics');
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

    if (subscriptionCache.isInvalid(userId)) return null;

    const cached = subscriptionCache.get(userId);
    if (cached !== undefined) return cached;

    try {
        const member = await tg.getChatMember(config.REQUIRED_CHANNEL, userId);
        const result = ['creator', 'administrator', 'member'].includes(member.status);
        subscriptionCache.set(userId, result);
        return result;
    } catch (error) {
        if (error.message && error.message.includes('PARTICIPANT_ID_INVALID')) {
            subscriptionCache.markInvalid(userId);
            log('warning', `User ${userId} marked as invalid (PARTICIPANT_ID_INVALID); future subscription checks skipped`);
            return null;
        }
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

    // Параллельная проверка подписок: пул из 5 воркеров.
    // Ограничение 5 безопасно для Bot API (лимит ~30 req/s); кеш + invalid-list дополнительно срезают трафик.
    const subscriptionStatuses = new Map();
    if (config.CHECK_SUBSCRIPTION && userList.length > 0) {
        const queue = [...userList];
        const worker = async () => {
            while (queue.length) {
                const user = queue.shift();
                const subscribed = await checkUserSubscription(user.userId, telegram);
                subscriptionStatuses.set(user.userId, subscribed);
            }
        };
        await Promise.all(Array.from({ length: 5 }, worker));
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

// Настройка меню и списка команд для админа (per-chat)
async function setupAdminMenu(botInstance) {
    const adminId = Number(config.ADMIN_ID);
    if (!adminId) return;

    try {
        await botInstance.telegram.setMyCommands([
            { command: 'stats', description: 'Статистика бота' },
            { command: 'users', description: 'Список пользователей' }
        ], { scope: { type: 'chat', chat_id: adminId } });

        await botInstance.telegram.setChatMenuButton({
            chatId: adminId,
            menuButton: { type: 'commands' }
        });

        log('success', `Admin menu configured for ADMIN_ID=${adminId}`);
    } catch (error) {
        log('error', `Failed to setup admin menu: ${error.message}`);
    }
}

// Инициализация планировщика
function initScheduler(botInstance) {
    bot = botInstance;

    if (!config.ADMIN_ID) {
        log('warning', 'ADMIN_ID not configured. Statistics reports are disabled.');
        return;
    }

    setupAdminMenu(botInstance);

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
}

// Хранение ID последних отчётов по chatId
const lastReportMessages = new Map();
const lastUsersMessages = new Map();

// Отправка отчёта по команде (для тестирования)
async function sendManualReport(ctx, period = 'daily') {
    const userId = ctx.from.id.toString();
    const chatId = ctx.chat.id;

    // Проверяем, является ли пользователь администратором
    if (!config.ADMIN_ID || userId !== config.ADMIN_ID.toString()) {
        await ctx.reply('❌ У вас нет прав для просмотра статистики.');
        return;
    }

    // Удаляем команду пользователя
    try { await ctx.deleteMessage(); } catch (e) {}

    // Удаляем предыдущий отчёт
    const prevMessageId = lastReportMessages.get(chatId);
    if (prevMessageId) {
        try { await ctx.telegram.deleteMessage(chatId, prevMessageId); } catch (e) {}
    }

    try {
        const stats = getStats(period);
        const message = await formatReport(stats, ctx.telegram);
        const sent = await ctx.reply(message, { parse_mode: 'Markdown' });
        lastReportMessages.set(chatId, sent.message_id);
    } catch (error) {
        log('error', `Failed to send manual report: ${error.message}`);
        await ctx.reply('❌ Ошибка при формировании отчёта.');
    }
}

// Telegram message limit — 4096 символов; пакуем чанки с запасом на header/footer
const USERS_CHUNK_LIMIT = 3800;

async function sendUsersList(ctx) {
    const userId = ctx.from.id.toString();
    const chatId = ctx.chat.id;

    if (!config.ADMIN_ID || userId !== config.ADMIN_ID.toString()) {
        await ctx.reply('❌ У вас нет прав для просмотра списка пользователей.');
        return;
    }

    try { await ctx.deleteMessage(); } catch (e) {}

    const prevMessageIds = lastUsersMessages.get(chatId);
    if (prevMessageIds && prevMessageIds.length) {
        for (const id of prevMessageIds) {
            try { await ctx.telegram.deleteMessage(chatId, id); } catch (e) {}
        }
    }

    try {
        const { totalUsers, users } = getAllUsersList();

        const header = `👥 *Пользователи бота*\n\nВсего: *${totalUsers}*\n\n`;
        const footer = `\n🕐 ${new Date().toLocaleString('ru-RU', { timeZone: config.REPORT_TIMEZONE })}`;

        const rows = users.length === 0
            ? [`ℹ️ Пока нет пользователей.`]
            : users.map((u, i) => {
                const displayName = (u.username && u.username !== 'Unknown')
                    ? `@${u.username}`
                    : `User ${u.userId}`;
                const link = `[${displayName}](tg://user?id=${u.userId})`;
                const lastSeen = new Date(u.lastSeen).toLocaleDateString('ru-RU', { timeZone: config.REPORT_TIMEZONE });
                return `${i + 1}. ${link} — ${u.totalRequests} запросов · ${lastSeen}\n`;
            });

        // Пакуем строки в чанки
        const chunks = [];
        let current = header;
        for (const row of rows) {
            if (current.length + row.length > USERS_CHUNK_LIMIT) {
                chunks.push(current);
                current = '';
            }
            current += row;
        }
        if (current) chunks.push(current);

        // Footer кладём в последний чанк (если влезает) или отдельным
        if (chunks.length && chunks[chunks.length - 1].length + footer.length <= USERS_CHUNK_LIMIT) {
            chunks[chunks.length - 1] += footer;
        } else {
            chunks.push(footer.trimStart());
        }

        const sentIds = [];
        for (const chunk of chunks) {
            const sent = await ctx.reply(chunk, { parse_mode: 'Markdown' });
            sentIds.push(sent.message_id);
        }
        lastUsersMessages.set(chatId, sentIds);
    } catch (error) {
        log('error', `Failed to send users list: ${error.message}`);
        await ctx.reply('❌ Ошибка при формировании списка пользователей.');
    }
}

module.exports = {
    initScheduler,
    sendManualReport,
    sendUsersList
};
