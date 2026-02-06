const cron = require('node-cron');
const config = require('../../config/config');
const { log } = require('../utils/logger');
const { getStats, resetStats } = require('../utils/analytics');

let bot = null;

// Форматирование отчёта
function formatReport(stats) {
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

    let message = `📊 *Статистика бота ${periodName}*\n\n`;
    message += `👥 Активных пользователей: *${activeUsers}*\n`;
    message += `🔢 Всего пользователей: *${totalUsers}*\n\n`;

    if (userList.length > 0) {
        message += `📋 *Список пользователей:*\n`;
        userList.forEach((user, index) => {
            const username = user.username !== 'Unknown' ? `@${user.username}` : `User ${index + 1}`;
            message += `${index + 1}. ${username} — ${user.requests} запросов\n`;
        });
    } else {
        message += `ℹ️ За этот период активности не было.`;
    }

    message += `\n🕐 Отчёт сформирован: ${new Date().toLocaleString('ru-RU', { timeZone: config.REPORT_TIMEZONE })}`;

    return message;
}

// Отправка отчёта администратору
async function sendReport(period) {
    if (!bot || !config.ADMIN_ID) {
        log('warning', 'Cannot send report: bot or ADMIN_ID not configured');
        return;
    }

    try {
        const stats = getStats(period);
        const message = formatReport(stats);

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
            // Каждый день в указанное время
            cronExpression = `${minutes} ${hours} * * *`;
            break;
        case 'weekly':
            // Каждый понедельник в указанное время
            cronExpression = `${minutes} ${hours} * * 1`;
            break;
        case 'monthly':
            // 1-го числа каждого месяца в указанное время
            cronExpression = `${minutes} ${hours} 1 * *`;
            break;
        default:
            log('error', `Invalid REPORT_FREQUENCY: ${config.REPORT_FREQUENCY}`);
            return;
    }

    log('info', `Scheduling reports: ${config.REPORT_FREQUENCY} at ${config.REPORT_TIME} ${config.REPORT_TIMEZONE}`);
    log('info', `Cron expression: ${cronExpression}`);

    // Создаём задачу [web:67]
    cron.schedule(cronExpression, () => {
        log('info', `Sending ${config.REPORT_FREQUENCY} report...`);
        sendReport(config.REPORT_FREQUENCY);
    }, {
        scheduled: true,
        timezone: config.REPORT_TIMEZONE
    });

    log('success', `Report scheduler initialized successfully!`);
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
        const message = formatReport(stats);
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
