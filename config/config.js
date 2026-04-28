require('dotenv').config();
const path = require('path');

module.exports = {
    // Telegram
    BOT_TOKEN: process.env.BOT_TOKEN,
    REQUIRED_CHANNEL: process.env.REQUIRED_CHANNEL,
    CHECK_SUBSCRIPTION: process.env.CHECK_SUBSCRIPTION === 'true',

    // Proxy (Shadowsocks/SOCKS5 для Telegram API)
    PROXY_HOST: process.env.PROXY_HOST,
    PROXY_PORT: process.env.PROXY_PORT,

    // Rate Limiting
    RATE_LIMIT: 1000,

    // Управление файлами
    MAX_FILES_PER_USER: 15,
    FILE_LIFETIME: 10 * 60 * 1000,
    BATCH_SIZE: 10,

    // Директории
    LOGS_DIR: path.join(__dirname, '..', 'logs'),
    TEMP_DIR: path.join(__dirname, '..', 'temp'),

    // APIs
    TIKTOK_API_URL: 'https://tikwm.com/api/',

    // Статистика и отчёты
    ADMIN_ID: (process.env.ADMIN_ID || '').trim() || null,
    REPORT_FREQUENCY: process.env.REPORT_FREQUENCY || 'daily',
    REPORT_TIME: process.env.REPORT_TIME || '20:00',
    REPORT_TIMEZONE: process.env.REPORT_TIMEZONE || 'Europe/Moscow',

    // Напоминание о подписке (в днях)
    SUBSCRIPTION_REMINDER_DAYS: parseInt(process.env.SUBSCRIPTION_REMINDER_DAYS) || 5,

    // ── Autoposter integration ────────────────────────────
    // URL Python-сервиса по docker-сети (или http://host:8000 в dev).
    // Если пусто — форвардинг отключён, бот работает как обычно.
    AUTOPOSTER_URL: process.env.AUTOPOSTER_URL || null,
    // Общий секрет в Authorization: Bearer <...>. Должен совпадать с .env у autoposter.
    INGEST_SECRET: process.env.INGEST_SECRET || null,
    // Только этот user_id триггерит форвардинг (защита от чужого контента).
    FORWARD_USER_ID: process.env.FORWARD_USER_ID
        ? Number(process.env.FORWARD_USER_ID)
        : null,
    // Внутренний путь shared-volume'а (mount в Dokploy).
    SHARED_INGEST_DIR: process.env.SHARED_INGEST_DIR || '/data/ingest',
};
