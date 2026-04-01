const fs = require('fs');
const path = require('path');
const config = require('../../config/config');

// Создаем папку для логов, если её нет
if (!fs.existsSync(config.LOGS_DIR)) {
    fs.mkdirSync(config.LOGS_DIR, { recursive: true });
}

// Удаление логов старше 7 дней
function cleanOldLogs() {
    try {
        const files = fs.readdirSync(config.LOGS_DIR);
        const now = Date.now();
        const maxAge = 7 * 24 * 60 * 60 * 1000;

        for (const file of files) {
            if (!file.startsWith('bot-') || !file.endsWith('.log')) continue;
            const filePath = path.join(config.LOGS_DIR, file);
            const stat = fs.statSync(filePath);
            if (now - stat.mtimeMs > maxAge) {
                fs.unlinkSync(filePath);
            }
        }
    } catch (e) {
        // Не прерываем работу бота из-за ошибки очистки
    }
}

// Очистка при старте и раз в сутки
cleanOldLogs();
setInterval(cleanOldLogs, 24 * 60 * 60 * 1000);

function log(level, message, userId = null) {
    const timestamp = new Date().toISOString();
    const userInfo = userId ? `[User: ${userId}]` : '';
    const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${userInfo} ${message}`;

    // Цвета для консоли
    const colors = {
        info: '\x1b[36m',    // Cyan
        success: '\x1b[32m', // Green
        warning: '\x1b[33m', // Yellow
        error: '\x1b[31m',   // Red
        reset: '\x1b[0m'
    };

    console.log(`${colors[level] || colors.info}${logMessage}${colors.reset}`);

    // Записываем в файл
    const logFile = path.join(config.LOGS_DIR, `bot-${new Date().toISOString().split('T')[0]}.log`);
    fs.appendFileSync(logFile, logMessage + '\n');
}

module.exports = { log };
