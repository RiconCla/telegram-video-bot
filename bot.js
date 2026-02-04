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
const RATE_LIMIT = 2000; // 5 секунд между запросами

// Константы для управления файлами
const MAX_FILES_PER_USER = 15;
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

            // СНАЧАЛА проверяем наличие изображений (слайдшоу)
            // Это важно, потому что для слайдшоу API возвращает И изображения, И видео с черным фоном
            if (data.images && Array.isArray(data.images) && data.images.length > 0) {
                log('success', `TikTok slideshow: ${data.images.length} images`, userId);
                return {
                    success: true,
                    type: 'image',
                    url: data.images,  // массив URL изображений
                    thumbnail: data.cover
                };
            }

            // ПОТОМ проверяем видео (только если нет изображений)
            if (data.play) {
                log('success', 'TikTok video download successful', userId);
                log('info', `Video URL: ${data.play.substring(0, 100)}...`, userId);
                return {
                    success: true,
                    type: 'video',
                    url: data.hdplay || data.play,  // приоритет HD качеству
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
// СКАЧИВАНИЕ С INSTAGRAM (МНОЖЕСТВЕННЫЕ МЕТОДЫ)
// ============================================

async function downloadInstagram(url, userId) {
    log('info', `Starting Instagram download: ${url}`, userId);

    // Метод 1: RapidAPI Instagram Downloader
    try {
        log('info', 'Trying Method 1: RapidAPI', userId);

        const response = await axios.get('https://instagram-downloader-download-instagram-stories-videos4.p.rapidapi.com/convert', {
            params: {
                url: url
            },
            headers: {
                'x-rapidapi-host': 'instagram-downloader-download-instagram-stories-videos4.p.rapidapi.com',
                'x-rapidapi-key': 'b7b7194ea4mshb3a8f7d61567aa8p1663f0jsn781d3c4e2970'
            },
            timeout: 15000
        });

        if (response.data) {
            const data = response.data;

            // Правильный формат: data.media - это массив
            if (data.media && Array.isArray(data.media) && data.media.length > 0) {
                const mediaItem = data.media[0];

                if (mediaItem.url) {
                    const mediaType = mediaItem.type || 'video';
                    log('success', `Method 1 successful: ${mediaType}`, userId);
                    return {
                        success: true,
                        type: mediaType,
                        url: mediaItem.url
                    };
                }
            }

            // Запасные варианты
            if (data.download_url) {
                log('success', 'Method 1 successful', userId);
                return { success: true, type: 'video', url: data.download_url };
            }

            log('warning', `Method 1 unexpected response format`, userId);
        }
    } catch (error) {
        log('warning', `Method 1 failed: ${error.message}`, userId);
    }

    // Метод 2: Прямой запрос к Instagram (упрощённый)
    try {
        log('info', 'Trying Method 2: Instagram direct', userId);

        const shortcode = url.match(/\/(p|reel|tv)\/([^/?]+)/)?.[2];
        if (shortcode) {
            const response = await axios.get(`https://www.instagram.com/reel/${shortcode}/`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                },
                timeout: 15000
            });

            const html = response.data;

            // Ищем video_url в HTML
            const videoMatch = html.match(/"video_url":"([^"]+)"/);
            if (videoMatch) {
                const videoUrl = videoMatch[1].replace(/\\u0026/g, '&').replace(/\\/g, '');
                log('success', 'Method 2 successful: video', userId);
                return { success: true, type: 'video', url: videoUrl };
            }

            // Ищем display_url для изображений
            const imageMatch = html.match(/"display_url":"([^"]+)"/);
            if (imageMatch) {
                const imageUrl = imageMatch[1].replace(/\\/g, '');
                log('success', 'Method 2 successful: image', userId);
                return { success: true, type: 'image', url: imageUrl };
            }
        }
    } catch (error) {
        log('warning', `Method 2 failed: ${error.message}`, userId);
    }

    // Метод 3: Старый embed метод
    try {
        log('info', 'Trying Method 3: Legacy embed', userId);

        const embedUrl = url.includes('?') ? url.split('?')[0] : url;
        const finalUrl = embedUrl.endsWith('/') ? embedUrl + 'embed/captioned' : embedUrl + '/embed/captioned';

        const htmlResponse = await axios.get(finalUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 15000
        });

        const html = htmlResponse.data;
        let mediaUrl = '';
        let type = 'video';

        if (html.includes('video_url')) {
            const match = html.match(/"video_url":"([^"]+)"/);
            if (match) {
                mediaUrl = match[1].replace(/\\u0026/g, '&').replace(/\\/g, '');
                type = 'video';
            }
        }

        if (!mediaUrl && html.includes('display_url')) {
            const match = html.match(/"display_url":"([^"]+)"/);
            if (match) {
                mediaUrl = match[1].replace(/\\/g, '');
                type = 'image';
            }
        }

        if (mediaUrl) {
            log('success', `Method 3 successful: ${type}`, userId);
            return {
                success: true,
                type: type,
                url: mediaUrl
            };
        }
    } catch (error) {
        log('warning', `Method 3 failed: ${error.message}`, userId);
    }

    log('error', 'All Instagram download methods failed', userId);
    return { success: false };
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
                    const videoPath = await downloadMediaFile(result.url, userId, 'video.mp4');

                    // Редактируем сообщение вместо удаления
                    try {
                        await ctx.telegram.editMessageText(
                            ctx.chat.id,
                            loadingMsg.message_id,
                            null,
                            '📤 Отправляю видео...'
                        );
                    } catch (e) {
                        log('warning', 'Could not edit loading message', userId);
                    }

                    await ctx.replyWithVideo(
                        Input.fromLocalFile(videoPath),
                        {caption: '✅ Видео скачано'}
                    );
                    log('success', 'Video sent successfully', userId);
                } catch (sendError) {
                    log('error', `Failed to send video: ${sendError.message}`, userId);
                    throw sendError;
                }

            } else if (result.type === 'image' || Array.isArray(result.url)) {
                if (Array.isArray(result.url)) {
                    // Для TikTok слайдшоу (несколько изображений)
                    const totalImages = result.url.length;
                    log('info', `Sending ${totalImages} images to user as media groups`, userId);

                    try {
                        // Редактируем сообщение о загрузке
                        try {
                            await ctx.telegram.editMessageText(
                                ctx.chat.id,
                                loadingMsg.message_id,
                                null,
                                `📤 Отправляю ${totalImages} изображений...`
                            );
                        } catch (e) {
                        }

                        const BATCH_SIZE = 10; // Telegram лимит для медиа-группы
                        const batches = Math.ceil(totalImages / BATCH_SIZE);
                        let totalSent = 0;

                        // Обрабатываем по 10 изображений за раз
                        for (let batch = 0; batch < batches; batch++) {
                            const startIndex = batch * BATCH_SIZE;
                            const endIndex = Math.min(startIndex + BATCH_SIZE, totalImages);
                            const batchUrls = result.url.slice(startIndex, endIndex);

                            log('info', `Processing batch ${batch + 1}/${batches} (images ${startIndex + 1}-${endIndex})`, userId);

                            // Скачиваем изображения текущей порции
                            const imagePaths = [];
                            for (let i = 0; i < batchUrls.length; i++) {
                                try {
                                    const imageUrl = batchUrls[i];
                                    const imagePath = await downloadMediaFile(imageUrl, userId, `batch${batch}_image_${i}.jpg`);
                                    imagePaths.push(imagePath);
                                } catch (downloadError) {
                                    log('error', `Failed to download image ${startIndex + i}: ${downloadError.message}`, userId);
                                }
                            }

                            // Отправляем медиа-группу
                            if (imagePaths.length > 0) {
                                const mediaGroup = imagePaths.map((path, index) => ({
                                    type: 'photo',
                                    media: Input.fromLocalFile(path),
                                    // Подпись только к первой картинке
                                    caption: (batch === 0 && index === 0)
                                        ? `✅ Скачано ${totalImages} изображений${batches > 1 ? ` (часть ${batch + 1}/${batches})` : ''}`
                                        : (batch > 0 && index === 0)
                                            ? `📸 Часть ${batch + 1}/${batches}`
                                            : undefined
                                }));

                                await ctx.replyWithMediaGroup(mediaGroup);
                                totalSent += imagePaths.length;
                                log('success', `Sent batch ${batch + 1}: ${imagePaths.length} images`, userId);

                                // Удаляем файлы после отправки
                                for (const path of imagePaths) {
                                    try {
                                        const fs = require('fs');
                                        if (fs.existsSync(path)) {
                                            fs.unlinkSync(path);
                                            log('info', `Deleted temp file: ${path.split('/').pop()}`, userId);
                                        }
                                    } catch (deleteError) {
                                        log('warning', `Could not delete file: ${path}`, userId);
                                    }
                                }
                            }

                            // Пауза между отправками
                            if (batch < batches - 1) {
                                await new Promise(resolve => setTimeout(resolve, 500));
                            }
                        }

                        if (totalSent > 0) {
                            log('success', `Successfully sent all ${totalSent} images in ${batches} batch(es)`, userId);
                        } else {
                            throw new Error('Failed to send any images');
                        }

                    } catch (sendError) {
                        log('error', `Failed to send media groups: ${sendError.message}`, userId);
                        throw sendError;
                    }

                } else {
                    // Для одиночного изображения (Instagram)
                    log('info', 'Sending single image to user', userId);

                    try {
                        const imagePath = await downloadMediaFile(result.url, userId, 'image.jpg');

                        try {
                            await ctx.telegram.editMessageText(
                                ctx.chat.id,
                                loadingMsg.message_id,
                                null,
                                '📤 Отправляю изображение...'
                            );
                        } catch (e) {
                        }

                        await ctx.replyWithPhoto(
                            Input.fromLocalFile(imagePath),
                            {caption: '✅ Изображение скачано'}
                        );
                    } catch (sendError) {
                        log('error', `Failed to send image: ${sendError.message}`, userId);
                        throw sendError;
                    }
                }
            }


            log('success', 'Media sent successfully', userId);
            await ctx.reply('💡 Отправь новую ссылку для скачивания!');

        } else {
            // Редактируем сообщение при ошибке
            try {
                await ctx.telegram.editMessageText(
                    ctx.chat.id,
                    loadingMsg.message_id,
                    null,
                    '❌ Ошибка загрузки'
                );
            } catch (e) {
            }

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

        // Редактируем сообщение при критической ошибке
        try {
            await ctx.telegram.editMessageText(
                ctx.chat.id,
                loadingMsg.message_id,
                null,
                '❌ Произошла ошибка'
            );
        } catch (e) {
        }

        await ctx.reply('❌ Произошла ошибка при обработке запроса. Попробуйте еще раз.');
    }
})

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
