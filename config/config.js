require('dotenv').config();
const path = require('path');

// Разбор списка каналов из ENV: "@a, @b" → ['@a', '@b'] (тримит, отбрасывает пустые)
function parseChannelList(raw) {
    return (raw || '').split(',').map(s => s.trim()).filter(Boolean);
}

// Разбор списка целых чисел из ENV: "12, 48, 168" → [12, 48, 168]
function parseIntList(raw) {
    return (raw || '').split(',').map(s => parseInt(s.trim(), 10)).filter(n => Number.isFinite(n) && n > 0);
}

module.exports = {
    // Telegram
    BOT_TOKEN: process.env.BOT_TOKEN,
    // Каналы, обязательные для всех языков
    REQUIRED_CHANNELS: parseChannelList(process.env.REQUIRED_CHANNELS),
    // Доп. каналы, обязательные только для ru-юзеров
    REQUIRED_CHANNELS_RU: parseChannelList(process.env.REQUIRED_CHANNELS_RU),
    CHECK_SUBSCRIPTION: process.env.CHECK_SUBSCRIPTION === 'true',

    // Proxy (Shadowsocks/SOCKS5 для Telegram API)
    PROXY_HOST: process.env.PROXY_HOST,
    PROXY_PORT: process.env.PROXY_PORT,

    // APIs
    TIKTOK_API_URL: 'https://tikwm.com/api/',

    // Rate Limiting
    RATE_LIMIT: 1000,

    // Управление файлами
    MAX_FILES_PER_USER: 15,
    FILE_LIFETIME: 10 * 60 * 1000,
    BATCH_SIZE: 10,

    // Директории
    LOGS_DIR: path.join(__dirname, '..', 'logs'),
    TEMP_DIR: path.join(__dirname, '..', 'temp'),

    // ── Прокси для загрузки (yt-dlp + Instagram embed-фоллбек) ───
    // SOCKS5-выход в не-заблокированную зону (контейнер ss-proxy над Shadowsocks).
    // Пусто → без прокси (прямой доступ). Формат: socks5h://host:port
    DL_PROXY: process.env.DL_PROXY || 'socks5h://ss-proxy:1080',

    // Статистика и отчёты
    ADMIN_ID: (process.env.ADMIN_ID || '').trim() || null,
    REPORT_FREQUENCY: process.env.REPORT_FREQUENCY || 'daily',
    REPORT_TIME: process.env.REPORT_TIME || '20:00',
    REPORT_TIMEZONE: process.env.REPORT_TIMEZONE || 'Europe/Moscow',

    // Эскалирующие напоминания о подписке: часы (кумулятивно от первого показа гейта)
    // до 1/2/3-го напоминания. После последнего бот перестаёт напоминать.
    // Дефолт: 12ч → 2д → 7д.
    SUBSCRIPTION_REMINDER_SCHEDULE: parseIntList(process.env.SUBSCRIPTION_REMINDER_SCHEDULE || '12,48,168'),

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
