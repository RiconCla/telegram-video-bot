const { Telegraf } = require('telegraf');
const config = require('./config/config');
const { log } = require('./src/utils/logger');
const { clearAllUserFiles } = require('./src/utils/fileManager');
const { rateLimitMiddleware } = require('./src/middleware/rateLimit');
const {
    handleStart,
    handleLanguageSelectStart,
    handleLanguageSelect,
    handleLaunchButton,
    handleCheckSubscription
} = require('./src/handlers/start');
const { handleLangCommand, handleLangChangeMenu, handleNoAskLang } = require('./src/handlers/lang');
const { handleUrl } = require('./src/handlers/url');
const { isUserActive } = require('./src/utils/i18n');
const { handleBotError } = require('./src/handlers/error');
const { initScheduler, sendManualReport } = require('./src/services/scheduler');
const { trackUser } = require('./src/utils/analytics');
const { runHealthcheck } = require('./src/services/tiktokHealthcheck');
const { SocksProxyAgent } = require('socks-proxy-agent');

// Прокси для Telegram API (обязательно для серверов в РФ)
const botOptions = { handlerTimeout: 15 * 60 * 1000 };

if (config.PROXY_HOST && config.PROXY_PORT) {
    const agent = new SocksProxyAgent(`socks5://${config.PROXY_HOST}:${config.PROXY_PORT}`);
    botOptions.telegram = { agent };
    console.log(`🔒 Telegram API → proxy: ${config.PROXY_HOST}:${config.PROXY_PORT}`);
} else {
    console.log('⚠️  No proxy configured — Telegram API direct (may fail in RU)');
}

const bot = new Telegraf(config.BOT_TOKEN, botOptions);


// ============================================
// MIDDLEWARE
// ============================================

bot.use(rateLimitMiddleware);

// ============================================
// КОМАНДЫ
// ============================================

bot.start(handleStart);

// Выбор языка из /start (активирует бота сразу)
bot.action('lang_en_start', handleLanguageSelectStart);
bot.action('lang_ru_start', handleLanguageSelectStart);

// Выбор языка из /lang или кнопки «Сменить язык» (только меняет язык)
bot.action('lang_en', handleLanguageSelect);
bot.action('lang_ru', handleLanguageSelect);

// Смена языка
bot.command('lang', handleLangCommand);
bot.action('lang_change_menu', handleLangChangeMenu);
bot.action('lang_no_ask', handleNoAskLang);

// Кнопки запуска (обе локали)
bot.hears(['🚀 Запуск бота', '🚀 Launch bot'], handleLaunchButton);

// Проверка подписки
bot.action('check_subscription', handleCheckSubscription);

// ============================================
// КОМАНДЫ СТАТИСТИКИ (только для админа)
// ============================================

bot.command('stats', async (ctx) => {
    await sendManualReport(ctx, 'daily');
});

bot.command('stats_weekly', async (ctx) => {
    await sendManualReport(ctx, 'weekly');
});

bot.command('stats_monthly', async (ctx) => {
    await sendManualReport(ctx, 'monthly');
});

bot.command('check_tiktok', async (ctx) => {
    const userId = ctx.from.id.toString();

    if (config.ADMIN_ID && userId !== config.ADMIN_ID.toString()) {
        await ctx.reply('❌ No permission for this command.');
        return;
    }

    await ctx.reply('🔍 Running TikTok API check...');
    await runHealthcheck(bot);
    await ctx.reply('✅ Check complete. See logs for details.');
});


// ============================================
// ОБРАБОТКА ТЕКСТОВЫХ СООБЩЕНИЙ (ССЫЛОК)
// ============================================

bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const messageText = ctx.message.text.trim();

    // Игнорируем команды и кнопки запуска
    if (
        messageText.startsWith('/') ||
        messageText === '🚀 Запуск бота' ||
        messageText === '🚀 Launch bot'
    ) {
        return;
    }

    await handleUrl(ctx, isUserActive(userId));
});

// ============================================
// ОБРАБОТКА ОШИБОК
// ============================================

bot.catch(handleBotError);

// ============================================
// ЗАПУСК БОТА
// ============================================

bot.launch()
    .then(() => {
        log('success', `Bot started successfully! Subscription check: ${config.CHECK_SUBSCRIPTION ? 'ENABLED' : 'DISABLED'}`);
        initScheduler(bot);
        console.log('\n' + '='.repeat(50));
        console.log('🤖 BOT CONFIGURATION:');
        console.log('='.repeat(50));
        console.log(`📝 Config: environment variables`);
        console.log(`🔐 Token: ${config.BOT_TOKEN ? '✅ Loaded' : '❌ Missing'}`);
        console.log(`📢 Required channel: ${config.REQUIRED_CHANNEL || 'Not set'}`);
        console.log(`✓  Subscription check: ${config.CHECK_SUBSCRIPTION ? '🟢 ENABLED' : '🔴 DISABLED'}`);
        console.log(`⏱  Rate limit: ${config.RATE_LIMIT / 1000} seconds`);
        console.log(`📁 Logs directory: ${config.LOGS_DIR}`);
        console.log(`📁 Temp directory: ${config.TEMP_DIR}`);
        console.log(`🗂  Max files per user: ${config.MAX_FILES_PER_USER}`);
        console.log(`⏰ File lifetime: ${config.FILE_LIFETIME / 60000} minutes`);
        console.log('='.repeat(50));
        console.log('\n💡 Press Ctrl+C to stop the bot\n');
    })
    .catch((error) => {
        log('error', `Bot launch failed: ${error.message}`);
        console.error('Full error:', error);
        process.exit(1);
    });

// ============================================
// GRACEFUL SHUTDOWN
// ============================================

process.once('SIGINT', () => {
    log('warning', 'Bot stopping (SIGINT)...');
    clearAllUserFiles();
    bot.stop('SIGINT');
    process.exit(0);
});

process.once('SIGTERM', () => {
    log('warning', 'Bot stopping (SIGTERM)...');
    clearAllUserFiles();
    bot.stop('SIGTERM');
    process.exit(0);
});

process.on('unhandledRejection', (reason, promise) => {
    log('error', `Unhandled Rejection: ${reason}`);
    console.error('Promise:', promise);
});

process.on('uncaughtException', (error) => {
    log('error', `Uncaught Exception: ${error.message}`);
    console.error('Full error:', error);
    clearAllUserFiles();
    process.exit(1);
});
