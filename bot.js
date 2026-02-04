require('dotenv').config({ path: './credit.env' });
const { Telegraf, Markup } = require('telegraf');
const { Input } = require('telegraf');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const bot = new Telegraf(process.env.BOT_TOKEN);
const REQUIRED_CHANNEL = process.env.REQUIRED_CHANNEL;
const CHECK_SUBSCRIPTION = process.env.CHECK_SUBSCRIPTION === 'true';

// Хранилище состояний пользователей для параллельной работы
const userStates = new Map();

// Хранилище файлов пользователей (максимум 3 файла на пользователя)
const userFiles = new Map();

// Защита от спама
const userLastRequest = new Map();
const RATE_LIMIT = 5000; // 5 секунд между запросами

// Константы для управления файлами
const MAX_FILES_PER_USER = 3;
const FILE_LIFETIME = 10 * 60 * 1000; // 10 минут

// ============================================
// ЛОГИРОВАНИЕ
// ============================================

// Создаем папку для логов, если её нет
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir);
}

// Создаем папку для временных файлов, если её нет
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir);
}

// Функция логирования
function log(level, message, userId = null) {
    const timestamp = new Date().toISOString();
    const userInfo = userId ? `[User: ${userId}]` : '';
    const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${userInfo} ${message}`;

    // Логируем в консоль с цветами
    const colors = {
        info: '\x1b[36m',    // Cyan
        success: '\x1b[32m', // Green
        warning: '\x1b[33m', // Yellow
        error: '\x1b[31m',   // Red
        reset: '\x1b[0m'
    };

    console.log(`${colors[level] || colors.info}${logMessage}${colors.reset}`);

    // Записываем в файл
    const logFile = path.join(logsDir, `bot-${new Date().toISOString().split('T')[0]}.log`);
    fs.appendFileSync(logFile, logMessage + '\\n');
}

// ============================================
// УПРАВЛЕНИЕ ФАЙЛАМИ
// ============================================

// Добавление файла в очередь пользователя
function addUserFile(userId, filePath) {
    if (!userFiles.has(userId)) {
        userFiles.set(userId, []);
    }

    const files = userFiles.get(userId);

    // Если уже 3 файла, удаляем самый старый
    if (files.length >= MAX_FILES_PER_USER) {
        const oldestFile = files.shift();
        deleteFile(oldestFile.path, userId);

        // Отменяем таймер старого файла
        if (oldestFile.timer) {
            clearTimeout(oldestFile.timer);
        }
    }

    // Создаем таймер на удаление через 10 минут
    const timer = setTimeout(() => {
        deleteFileFromUser(userId, filePath);
    }, FILE_LIFETIME);

    // Добавляем новый файл
    files.push({
        path: filePath,
        createdAt: Date.now(),
        timer: timer
    });

    log('info', `File added to queue. Total files: ${files.length}/${MAX_FILES_PER_USER}`, userId);
}

// Удаление файла из очереди пользователя
function deleteFileFromUser(userId, filePath) {
    if (!userFiles.has(userId)) return;

    const files = userFiles.get(userId);
    const index = files.findIndex(f => f.path === filePath);

    if (index !== -1) {
        const file = files[index];

        // Отменяем таймер
        if (file.timer) {
            clearTimeout(file.timer);
        }

        // Удаляем файл
        deleteFile(filePath, userId);

        // Удаляем из массива
        files.splice(index, 1);

        log('info', `File removed from queue (timeout). Remaining: ${files.length}`, userId);

        // Если файлов больше нет, удаляем пользователя из Map
        if (files.length === 0) {
            userFiles.delete(userId);
        }
    }
}

// Физическое удаление файла
function deleteFile(filePath, userId = null) {
    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            log('success', `File deleted: ${path.basename(filePath)}`, userId);
        }
    } catch (error) {
        log('error', `Failed to delete file: ${error.message}`, userId);
    }
}

// Очистка всех файлов пользователя
function clearUserFiles(userId) {
    if (!userFiles.has(userId)) return;

    const files = userFiles.get(userId);

    files.forEach(file => {
        if (file.timer) {
            clearTimeout(file.timer);
        }
        deleteFile(file.path, userId);
    });

    userFiles.delete(userId);
    log('info', 'All user files cleared', userId);
}

// ============================================
// MIDDLEWARE: ЗАЩИТА ОТ СПАМА
// ============================================

bot.use(async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId) return next();

    // Пропускаем проверку для команды /start
    if (ctx.message?.text === '/start') {
        return next();
    }

    const lastRequest = userLastRequest.get(userId);
    const now = Date.now();

    if (lastRequest && (now - lastRequest) < RATE_LIMIT) {
        const waitTime = Math.ceil((RATE_LIMIT - (now - lastRequest)) / 1000);
        log('warning', `Rate limit exceeded. Wait ${waitTime}s`, userId);
        await ctx.reply(`⏱ Пожалуйста, подождите ${waitTime} секунд перед следующим запросом.`);
        return;
    }

    userLastRequest.set(userId, now);
    return next();
});

// ============================================
// ПРОВЕРКА ПОДПИСКИ НА КАНАЛ
// ============================================

async function checkSubscription(ctx) {
    if (!CHECK_SUBSCRIPTION) {
        log('info', 'Subscription check is disabled', ctx.from.id);
        return true;
    }

    try {
        const member = await ctx.telegram.getChatMember(
            REQUIRED_CHANNEL,
            ctx.from.id
        );

        const isSubscribed = ['creator', 'administrator', 'member'].includes(member.status);
        log('info', `Subscription check: ${isSubscribed ? 'PASSED' : 'FAILED'}`, ctx.from.id);
        return isSubscribed;
    } catch (error) {
        log('error', `Subscription check error: ${error.message}`, ctx.from.id);
        return false;
    }
}

// ============================================
// ВАЛИДАЦИЯ URL
// ============================================

function validateUrl(url) {
    const tiktokRegex = /(?:https?:\/\/)?(?:www\.|vm\.|vt\.)?tiktok\.com\/.+/i;
    const instagramRegex = /(?:https?:\/\/)?(?:www\.)?instagram\.com\/(p|reel|tv)\/[A-Za-z0-9_-]+/i;

    return {
        isTiktok: tiktokRegex.test(url),
        isInstagram: instagramRegex.test(url)
    };
}

// ============================================
// СКАЧИВАНИЕ МЕДИА ФАЙЛОВ
// ============================================

async function downloadMediaFile(url, userId, filename) {
    try {
        // Проверяем, что URL валидный
        if (!url || typeof url !== 'string') {
            throw new Error(`Invalid URL: ${url}`);
        }

        // Проверяем, что это HTTP/HTTPS URL
        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            throw new Error(`URL must start with http:// or https://. Got: ${url.substring(0, 50)}...`);
        }

        log('info', `Downloading media file: ${filename} from ${url.substring(0, 100)}...`, userId);

        // Уникальное имя файла для каждого пользователя
        const filePath = path.join(tempDir, `${userId}_${Date.now()}_${filename}`);

        // Скачиваем файл с увеличенным таймаутом и дополнительными заголовками
        const response = await axios({
            method: 'GET',
            url: url,
            responseType: 'stream',
            timeout: 120000, // 120 секунд таймаут
            maxRedirects: 5,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': '*/*',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Referer': 'https://www.tiktok.com/'
            }
        });

        // Проверяем статус ответа
        if (response.status !== 200) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        // Создаем write stream
        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);

        // Ждем завершения загрузки
        await new Promise((resolve, reject) => {
            let downloadedBytes = 0;

            response.data.on('data', (chunk) => {
                downloadedBytes += chunk.length;
            });

            writer.on('finish', () => {
                log('success', `Media file downloaded: ${filename} (${(downloadedBytes / 1024 / 1024).toFixed(2)} MB)`, userId);
                resolve();
            });

            writer.on('error', (error) => {
                log('error', `File write error: ${error.message}`, userId);
                reject(error);
            });

            response.data.on('error', (error) => {
                log('error', `File download stream error: ${error.message}`, userId);
                reject(error);
            });
        });

        // Проверяем, что файл не пустой
        const stats = fs.statSync(filePath);
        if (stats.size === 0) {
            throw new Error('Downloaded file is empty');
        }

        log('info', `File saved successfully: ${filePath} (${stats.size} bytes)`, userId);

        // Добавляем файл в очередь пользователя
        addUserFile(userId, filePath);

        return filePath;

    } catch (error) {
        log('error', `Download media file error: ${error.message}`, userId);

        // Дополнительная информация для отладки
        if (error.response) {
            log('error', `HTTP Status: ${error.response.status}`, userId);
            log('error', `HTTP Headers: ${JSON.stringify(error.response.headers)}`, userId);
        }

        throw error;
    }
}

// ============================================
// СКАЧИВАНИЕ С TIKTOK (через tikwm.com API)
// ============================================

async function downloadTiktok(url, userId) {
    try {
        log('info', `Starting TikTok download: ${url}`, userId);

        // Используем публичное API для скачивания
        const apiUrl = 'https://tikwm.com/api/';

        const response = await axios.post(apiUrl, {
            url: url,
            hd: 1
        }, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        if (response.data && response.data.code === 0) {
            const data = response.data.data;

            if (data.play) {
                log('success', 'TikTok download successful: video', userId);
                log('info', `Video URL: ${data.play.substring(0, 100)}...`, userId);
                return {
                    success: true,
                    type: 'video',
                    url: data.hdplay || data.play,
                    thumbnail: data.cover
                };
            } else if (data.images && data.images.length > 0) {
                log('success', `TikTok download successful: ${data.images.length} images`, userId);
                return {
                    success: true,
                    type: 'image',
                    url: data.images,
                    thumbnail: data.cover
                };
            }
        }

        log('warning', 'TikTok download failed: Invalid API response', userId);
        return { success: false };

    } catch (error) {
        log('error', `TikTok download error: ${error.message}`, userId);
        return { success: false };
    }
}

// ============================================
// СКАЧИВАНИЕ С INSTAGRAM
// ============================================

async function downloadInstagram(url, userId) {
    try {
        log('info', `Starting Instagram download: ${url}`, userId);

        // Метод через embed
        const embedUrl = url.includes('?') ? url.split('?')[0] : url;
        const finalUrl = embedUrl.endsWith('/') ? embedUrl + 'embed/captioned' : embedUrl + '/embed/captioned';

        const htmlResponse = await axios.get(finalUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        const html = htmlResponse.data;
        let mediaUrl = '';
        let type = 'video';

        // Ищем видео
        if (html.includes('video_url')) {
            const match = html.match(/"video_url":"([^"]+)"/);
            if (match) {
                mediaUrl = match[1].replace(/\\u0026/g, '&').replace(/\\/g, '');
                type = 'video';
            }
        }

        // Если видео не найдено, ищем изображение
        if (!mediaUrl) {
            const match = html.match(/"display_url":"([^"]+)"/);
            if (match) {
                mediaUrl = match[1].replace(/\\/g, '');
                type = 'image';
            }
        }

        if (mediaUrl) {
            log('success', `Instagram download successful: ${type}`, userId);
            return {
                success: true,
                type: type,
                url: mediaUrl
            };
        }

        log('warning', 'Instagram download failed: Media not found', userId);
        return { success: false };

    } catch (error) {
        log('error', `Instagram download error: ${error.message}`, userId);
        return { success: false };
    }
}

// ============================================
// КОМАНДЫ БОТА
// ============================================

// Команда /start
bot.start(async (ctx) => {
    const userId = ctx.from.id;
    const username = ctx.from.username || ctx.from.first_name;

    log('info', `User started bot: @${username}`, userId);

    // Проверяем, новый ли пользователь
    const isNewUser = !userStates.has(userId);

    if (isNewUser) {
        await ctx.reply(
            '👋 Привет! Я помогу тебе скачать видео и фото из TikTok и Instagram без водяных знаков.\n\n' +
            '📥 Поддерживаемые платформы:\n' +
            '• TikTok (видео и слайдшоу)\n' +
            '• Instagram (посты, reels)\n\n' +
            'Нажми кнопку ниже, чтобы начать!',
            Markup.keyboard([
                ['🚀 Запуск бота']
            ]).resize()
        );
    } else {
        // Для существующих пользователей просто подтверждаем готовность
        await ctx.reply(
            '👋 С возвращением!\n\n' +
            '📝 Просто отправь мне ссылку на видео или изображение из TikTok или Instagram.',
            Markup.removeKeyboard()
        );
    }
});

// Обработка кнопки "Запуск бота"
bot.hears('🚀 Запуск бота', async (ctx) => {
    const userId = ctx.from.id;
    log('info', 'User clicked "Start bot" button', userId);

    const isSubscribed = await checkSubscription(ctx);

    if (!isSubscribed) {
        log('warning', 'User not subscribed to required channel', userId);
        await ctx.reply(
            '❌ Чтобы использовать бота, необходимо подписаться на канал!',
            Markup.inlineKeyboard([
                [Markup.button.url('📢 Подписаться', `https://t.me/${REQUIRED_CHANNEL.replace('@', '')}`)],
                [Markup.button.callback('✅ Я подписался', 'check_subscription')]
            ])
        );
        return;
    }

    userStates.set(userId, 'active');
    log('info', 'User state changed to: active', userId);

    await ctx.reply(
        '✅ Отлично! Теперь отправь мне ссылку на видео или изображение из TikTok или Instagram',
        Markup.removeKeyboard()
    );
});

// Обработка callback кнопки проверки подписки
bot.action('check_subscription', async (ctx) => {
    const userId = ctx.from.id;
    await ctx.answerCbQuery();

    log('info', 'User clicked "I subscribed" button', userId);

    const isSubscribed = await checkSubscription(ctx);

    if (!isSubscribed) {
        log('warning', 'Subscription verification failed', userId);
        await ctx.reply('❌ Вы все еще не подписаны на канал. Пожалуйста, подпишитесь и попробуйте снова.');
        return;
    }

    userStates.set(userId, 'active');
    log('success', 'Subscription verified successfully', userId);

    await ctx.reply(
        '✅ Отлично! Теперь отправь мне ссылку на видео или изображение из TikTok или Instagram',
        Markup.removeKeyboard()
    );
});

// Обработка текстовых сообщений (ссылок)
bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const userState = userStates.get(userId);
    const messageText = ctx.message.text.trim();

    // Игнорируем команды и кнопки
    if (messageText.startsWith('/') || messageText === '🚀 Запуск бота') {
        return;
    }

    // Если пользователь еще не активировал бота
    if (userState !== 'active') {
        log('warning', 'User sent message without activating bot', userId);
        await ctx.reply(
            'Нажмите кнопку "🚀 Запуск бота" для первого запуска.',
            Markup.keyboard([
                ['🚀 Запуск бота']
            ]).resize()
        );
        return;
    }

    log('info', `Received URL: ${messageText}`, userId);

    const validation = validateUrl(messageText);

    if (!validation.isTiktok && !validation.isInstagram) {
        log('warning', 'Invalid URL received', userId);
        await ctx.reply(
            '❌ Приложенная ссылка некорректна!\n\n' +
            '⚠️ Проверьте, что ссылка ведет именно на видео или изображение из TikTok или Instagram.\n\n' +
            '📝 Примеры правильных ссылок:\n' +
            '• TikTok: https://www.tiktok.com/@user/video...\n' +
            '• Instagram: https://www.instagram.com/p...\n' +
            '• Instagram: https://www.instagram.com/reel...'
        );
        return;
    }

    // Показываем сообщение о загрузке
    const loadingMsg = await ctx.reply('⏳ Загрузка, пожалуйста подождите...');
    log('info', 'Download started', userId);

    try {
        let result;

        if (validation.isTiktok) {
            result = await downloadTiktok(messageText, userId);
        } else if (validation.isInstagram) {
            result = await downloadInstagram(messageText, userId);
        }

        if (result.success) {
            if (result.type === 'video') {
                log('info', 'Sending video to user', userId);

                try {
                    // Скачиваем и отправляем видео
                    const videoPath = await downloadMediaFile(result.url, userId, 'video.mp4');

                    // Удаляем сообщение о загрузке ПЕРЕД отправкой
                    try {
                        await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id);
                    } catch (e) {
                        log('warning', 'Could not delete loading message', userId);
                    }

                    await ctx.replyWithVideo(
                        Input.fromLocalFile(videoPath),
                        { caption: '✅ Видео скачано без водяного знака!' }
                    );
                    log('success', 'Video sent successfully', userId);
                } catch (sendError) {
                    log('error', `Failed to send video: ${sendError.message}`, userId);
                    // Удаляем сообщение о загрузке в случае ошибки
                    try {
                        await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id);
                    } catch (e) {}
                    throw sendError;
                }

            } else if (result.type === 'image' || Array.isArray(result.url)) {
                // Для TikTok слайдов
                if (Array.isArray(result.url)) {
                    log('info', `Sending ${result.url.length} images to user`, userId);

                    let successCount = 0;
                    for (let i = 0; i < Math.min(result.url.length, 10); i++) {
                        try {
                            const imageUrl = result.url[i];
                            const imagePath = await downloadMediaFile(imageUrl, userId, `image_${i}.jpg`);

                            // Удаляем сообщение о загрузке перед отправкой первого изображения
                            if (i === 0) {
                                try {
                                    await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id);
                                } catch (e) {
                                    log('warning', 'Could not delete loading message', userId);
                                }
                            }

                            await ctx.replyWithPhoto(Input.fromLocalFile(imagePath));
                            successCount++;
                        } catch (sendError) {
                            log('error', `Failed to send image ${i}: ${sendError.message}`, userId);
                        }
                    }

                    if (successCount > 0) {
                        await ctx.reply('✅ Изображения скачаны без водяного знака!');
                    } else {
                        throw new Error('Failed to send any images');
                    }
                } else {
                    log('info', 'Sending image to user', userId);

                    try {
                        const imagePath = await downloadMediaFile(result.url, userId, 'image.jpg');

                        // Удаляем сообщение о загрузке ПЕРЕД отправкой
                        try {
                            await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id);
                        } catch (e) {
                            log('warning', 'Could not delete loading message', userId);
                        }

                        await ctx.replyWithPhoto(
                            Input.fromLocalFile(imagePath),
                            { caption: '✅ Изображение скачано без водяного знака!' }
                        );
                    } catch (sendError) {
                        log('error', `Failed to send image: ${sendError.message}`, userId);
                        // Удаляем сообщение о загрузке в случае ошибки
                        try {
                            await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id);
                        } catch (e) {}
                        throw sendError;
                    }
                }
            }

            log('success', 'Media sent successfully', userId);

            // Просто информируем, что можно отправить еще
            await ctx.reply('💡 Отправь новую ссылку для скачивания!');

        } else {
            await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id);
            log('error', 'Failed to download media', userId);
            await ctx.reply(
                '❌ Не удалось скачать медиа. Возможные причины:\n' +
                '• Неверная ссылка\n' +
                '• Приватный аккаунт\n' +
                '• Контент удален\n' +
                '• Временная недоступность сервиса\n\n' +
                '🔄 Попробуйте другую ссылку или повторите попытку позже.'
            );
        }
    } catch (error) {
        log('error', `Processing error: ${error.message}`, userId);
        try {
            await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id);
        } catch (e) {}
        await ctx.reply('❌ Произошла ошибка при обработке запроса. Попробуйте еще раз.');
    }
});

// ============================================
// ОБРАБОТКА ОШИБОК
// ============================================

bot.catch((err, ctx) => {
    const userId = ctx.from?.id;
    log('error', `Bot error: ${err.message}`, userId);
    console.error('Full error:', err);

    try {
        ctx.reply('❌ Произошла непредвиденная ошибка. Попробуйте позже или обратитесь к администратору.');
    } catch (e) {
        log('error', 'Failed to send error message to user', userId);
    }
});

// ============================================
// ЗАПУСК БОТА
// ============================================

bot.launch()
    .then(() => {
        log('success', `Bot started successfully! Subscription check: ${CHECK_SUBSCRIPTION ? 'ENABLED' : 'DISABLED'}`);
        console.log('\\n' + '='.repeat(50));
        console.log('🤖 BOT CONFIGURATION:');
        console.log('='.repeat(50));
        console.log(`📝 Config file: credit.env`);
        console.log(`🔐 Token: ${process.env.BOT_TOKEN ? '✅ Loaded' : '❌ Missing'}`);
        console.log(`📢 Required channel: ${REQUIRED_CHANNEL || 'Not set'}`);
        console.log(`✓  Subscription check: ${CHECK_SUBSCRIPTION ? '🟢 ENABLED' : '🔴 DISABLED'}`);
        console.log(`⏱  Rate limit: ${RATE_LIMIT / 1000} seconds`);
        console.log(`📁 Logs directory: ${logsDir}`);
        console.log(`📁 Temp directory: ${tempDir}`);
        console.log(`🗂  Max files per user: ${MAX_FILES_PER_USER}`);
        console.log(`⏰ File lifetime: ${FILE_LIFETIME / 60000} minutes`);
        console.log('='.repeat(50));
        console.log('\\n💡 Press Ctrl+C to stop the bot\\n');
    })
    .catch((error) => {
        log('error', `Bot launch failed: ${error.message}`);
        console.error('Full error:', error);
        process.exit(1);
    });

// Graceful stop
process.once('SIGINT', () => {
    log('warning', 'Bot stopping (SIGINT)...');

    // Очищаем все файлы при остановке
    userFiles.forEach((files, userId) => {
        clearUserFiles(userId);
    });

    bot.stop('SIGINT');
    process.exit(0);
});

process.once('SIGTERM', () => {
    log('warning', 'Bot stopping (SIGTERM)...');

    // Очищаем все файлы при остановке
    userFiles.forEach((files, userId) => {
        clearUserFiles(userId);
    });

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

    // Очищаем все файлы перед выходом
    userFiles.forEach((files, userId) => {
        clearUserFiles(userId);
    });

    process.exit(1);
});
