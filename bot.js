const { Telegraf } = require('telegraf');
const config = require('./config/config');
const { log } = require('./src/utils/logger');
const { clearAllUserFiles } = require('./src/utils/fileManager');
const { rateLimitMiddleware } = require('./src/middleware/rateLimit');
const { handleStart, handleLaunchButton, handleCheckSubscription, getUserState } = require('./src/handlers/start');
const { handleUrl } = require('./src/handlers/url');
const { handleBotError } = require('./src/handlers/error');

// Создаем бота
const bot = new Telegraf(config.BOT_TOKEN);

// ============================================
// MIDDLEWARE
// ============================================

bot.use(rateLimitMiddleware);

// ============================================
// КОМАНДЫ
// ============================================

bot.start(handleStart);

bot.hears('🚀 Запуск бота', handleLaunchButton);

bot.action('check_subscription', handleCheckSubscription);

// ============================================
// ОБРАБОТКА ТЕКСТОВЫХ СООБЩЕНИЙ (ССЫЛОК)
// ============================================

bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const messageText = ctx.message.text.trim();

    // Игнорируем команды и кнопки
    if (messageText.startsWith('/') || messageText === '🚀 Запуск бота') {
        return;
    }

    const userState = getUserState(userId);
    await handleUrl(ctx, userState);
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
        console.log('\n' + '='.repeat(50));
        console.log('🤖 BOT CONFIGURATION:');
        console.log('='.repeat(50));
        console.log(`📝 Config file: credit.env`);
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

// Обработка необработанных ошибок
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
