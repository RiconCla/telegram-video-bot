const cron = require('node-cron');
const config = require('../../config/config');
const { log } = require('../utils/logger');
const { getStats, resetStats, getAllUsersList, getFunnel, trackFunnel } = require('../utils/analytics');
const { getPendingUsers, removePending, recordReminder } = require('../utils/pendingSubscriptions');
const {
    checkSubscriptionForLang,
    checkChannelSubscription,
    buildSubscriptionKeyboard,
    pickReminderText
} = require('../middleware/subscription');

let bot = null;

function escapeMarkdown(text) {
    return String(text).replace(/[_*`\[]/g, '\\$&');
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
    // В отчёте отслеживаем только основной канал (первый в REQUIRED_CHANNELS), независимо от языка юзера.
    const subscriptionStatuses = new Map();
    const mainChannel = config.REQUIRED_CHANNELS[0];
    if (config.CHECK_SUBSCRIPTION && mainChannel && userList.length > 0) {
        const queue = [...userList];
        const worker = async () => {
            while (queue.length) {
                const user = queue.shift();
                const subscribed = await checkChannelSubscription(telegram, user.userId, mainChannel);
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

    // Воронка подписки (кумулятивно за всё время)
    if (config.CHECK_SUBSCRIPTION) {
        const f = getFunnel();
        const convRate = f.gatePrompts > 0 ? Math.round((f.conversions / f.gatePrompts) * 100) : 0;
        message += `\n\n📈 *Воронка подписки (всего):*\n`;
        message += `• Гейт показан: *${f.gatePrompts}*\n`;
        message += `• Подписалось: *${f.conversions}* (${convRate}%)\n`;
        message += `• Напоминаний отправлено: *${f.remindersSent}*`;
    }

    message += `\n\n🕐 Отчёт сформирован: ${new Date().toLocaleString('ru-RU', { timeZone: config.REPORT_TIMEZONE })}`;

    return message;
}

// Отправка эскалирующих напоминаний о подписке.
// Расписание SUBSCRIPTION_REMINDER_SCHEDULE — часы (кумулятивно от addedAt) до каждого
// напоминания. Юзер получает не больше, чем длина расписания, затем эскалация исчерпана.
async function sendSubscriptionReminders() {
    if (!bot || !config.CHECK_SUBSCRIPTION) return;

    const schedule = config.SUBSCRIPTION_REMINDER_SCHEDULE;
    if (!schedule.length) return;

    const pendingUsers = getPendingUsers();
    const now = new Date();
    let sent = 0;

    for (const { userId, addedAt, remindersSent, lang } of pendingUsers) {
        // Эскалация исчерпана — больше не напоминаем
        if (remindersSent >= schedule.length) continue;

        // Порог следующего напоминания ещё не наступил
        const dueMs = schedule[remindersSent] * 60 * 60 * 1000;
        if (now - addedAt < dueMs) continue;

        const effectiveLang = lang || 'en';

        // Проверяем, может пользователь уже подписался — с учётом его языка
        const { ok, missing } = await checkSubscriptionForLang(bot.telegram, userId, effectiveLang);
        if (ok) {
            removePending(userId);
            trackFunnel('conversions');
            log('info', `User subscribed since last check, removed from pending`, userId);
            continue;
        }

        const locale = effectiveLang === 'ru' ? require('../locales/ru') : require('../locales/en');
        const keyboard = buildSubscriptionKeyboard(locale, missing);
        try {
            await bot.telegram.sendMessage(userId, pickReminderText(locale, missing), {
                reply_markup: keyboard.reply_markup
            });
            recordReminder(userId); // инкремент remindersSent + lastReminder
            trackFunnel('remindersSent');
            sent++;
            log('info', `Subscription reminder ${remindersSent + 1}/${schedule.length} sent`, userId);
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

    // Эскалирующие напоминания о подписке — проверка каждые 6 часов
    if (config.CHECK_SUBSCRIPTION && config.SUBSCRIPTION_REMINDER_SCHEDULE.length > 0) {
        cron.schedule('0 */6 * * *', () => {
            log('info', 'Running subscription reminder check...');
            sendSubscriptionReminders();
        }, {
            scheduled: true,
            timezone: config.REPORT_TIMEZONE
        });
        log('success', `Subscription reminder scheduler initialized (schedule: ${config.SUBSCRIPTION_REMINDER_SCHEDULE.join('h, ')}h)`);
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
