require('dotenv').config({ path: './credit.env' });
const path = require('path');

module.exports = {
    // Telegram
    BOT_TOKEN: process.env.BOT_TOKEN,
    REQUIRED_CHANNEL: process.env.REQUIRED_CHANNEL,
    CHECK_SUBSCRIPTION: process.env.CHECK_SUBSCRIPTION === 'true',

    // Shadowsocks
    SHADOWSOCKS: {
        HOST: process.env.SHADOWSOCKS_HOST,
        PORT: process.env.SHADOWSOCKS_PORT,
        PASSWORD: process.env.SHADOWSOCKS_PASSWORD,
        METHOD: process.env.SHADOWSOCKS_METHOD
    },

    // Rate Limiting
    RATE_LIMIT: 1000, // миллисекунды

    // Управление файлами
    MAX_FILES_PER_USER: 15,
    FILE_LIFETIME: 10 * 60 * 1000, // 10 минут
    BATCH_SIZE: 10, // Telegram лимит медиа-группы

    // Директории
    LOGS_DIR: path.join(__dirname, '..', 'logs'),
    TEMP_DIR: path.join(__dirname, '..', 'temp'),

    // APIs
    RAPIDAPI_KEY: 'b7b7194ea4mshb3a8f7d61567aa8p1663f0jsn781d3c4e2970',
    RAPIDAPI_HOST: 'instagram-downloader-download-instagram-stories-videos4.p.rapidapi.com',
    TIKTOK_API_URL: 'https://tikwm.com/api/',

    // Статистика и отчёты
    ADMIN_ID: process.env.ADMIN_ID || null,
    REPORT_FREQUENCY: process.env.REPORT_FREQUENCY || 'daily',
    REPORT_TIME: process.env.REPORT_TIME || '20:00',
    REPORT_TIMEZONE: process.env.REPORT_TIMEZONE || 'Europe/Moscow'
};
