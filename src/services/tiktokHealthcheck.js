const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('../../config/config');
const { log } = require('../utils/logger');

// Путь к файлу с приоритетом
const PRIORITY_FILE = path.join(__dirname, '../../config/tiktok-priority.json');

// Тестовая ссылка для проверки
const TEST_URL = 'https://vt.tiktok.com/ZSm1h1kdu/';

// Минимальный размер видео в байтах (если меньше - считаем битым)
const MIN_VIDEO_SIZE = 500000; // 500 KB

// Текущий приоритет (загружается из файла)
let currentPriority = ['play', 'wmplay', 'hdplay'];

// Загрузка приоритета из файла при старте
function loadPriority() {
    try {
        if (fs.existsSync(PRIORITY_FILE)) {
            const data = fs.readFileSync(PRIORITY_FILE, 'utf8');
            const saved = JSON.parse(data);
            currentPriority = saved.priority || currentPriority;
            log('info', `TikTok priority loaded from file: ${currentPriority.join(' > ')}`);
        } else {
            log('info', `TikTok priority file not found, using default: ${currentPriority.join(' > ')}`);
        }
    } catch (error) {
        log('error', `Failed to load TikTok priority: ${error.message}`);
    }
}

// Сохранение приоритета в файл
function savePriority(priority) {
    try {
        const data = {
            priority: priority,
            lastUpdate: new Date().toISOString(),
            reason: 'Automatic healthcheck'
        };
        fs.writeFileSync(PRIORITY_FILE, JSON.stringify(data, null, 2), 'utf8');
        log('success', `TikTok priority saved to file: ${priority.join(' > ')}`);
    } catch (error) {
        log('error', `Failed to save TikTok priority: ${error.message}`);
    }
}

// Проверка качества видео URL
async function checkVideoQuality(url, type) {
    try {
        log('info', `Checking ${type} video quality...`);

        // Делаем HEAD запрос, чтобы узнать размер без полной загрузки
        const headResponse = await axios.head(url, {
            timeout: 10000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': 'https://www.tiktok.com/'
            }
        });

        const contentLength = parseInt(headResponse.headers['content-length'] || '0');

        if (contentLength < MIN_VIDEO_SIZE) {
            log('warning', `${type} video too small: ${contentLength} bytes (expected > ${MIN_VIDEO_SIZE})`);
            return { valid: false, size: contentLength, reason: 'Too small' };
        }

        // Проверяем, что это видео (не HTML страница с ошибкой)
        const contentType = headResponse.headers['content-type'] || '';
        if (!contentType.includes('video') && !contentType.includes('octet-stream')) {
            log('warning', `${type} invalid content type: ${contentType}`);
            return { valid: false, size: contentLength, reason: 'Invalid content-type' };
        }

        log('success', `${type} video is valid: ${(contentLength / 1024 / 1024).toFixed(2)} MB, type: ${contentType}`);
        return { valid: true, size: contentLength };

    } catch (error) {
        log('error', `${type} video check failed: ${error.message}`);
        return { valid: false, size: 0, reason: error.message };
    }
}

// Получение данных из TikTok API
async function getTikTokData() {
    try {
        const response = await axios.post(config.TIKTOK_API_URL, {
            url: TEST_URL,
            hd: 1
        }, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            timeout: 15000
        });

        if (response.data && response.data.code === 0) {
            return response.data.data;
        }

        return null;
    } catch (error) {
        log('error', `TikTok API request failed: ${error.message}`);
        return null;
    }
}

// Основная проверка здоровья API
async function runHealthcheck(bot) {
    log('info', '🔍 Starting TikTok API healthcheck...');

    const data = await getTikTokData();

    if (!data) {
        log('error', '❌ TikTok API healthcheck failed: No data received');
        return;
    }

    // Проверяем все доступные URL
    const results = {};

    if (data.play) {
        results.play = await checkVideoQuality(data.play, 'play');
    }

    if (data.wmplay) {
        results.wmplay = await checkVideoQuality(data.wmplay, 'wmplay');
    }

    if (data.hdplay) {
        results.hdplay = await checkVideoQuality(data.hdplay, 'hdplay');
    }

    // Определяем новый приоритет на основе результатов
    const newPriority = [];

    // Добавляем валидные URL в порядке предпочтения
    if (results.play?.valid) newPriority.push('play');
    if (results.wmplay?.valid) newPriority.push('wmplay');
    if (results.hdplay?.valid) newPriority.push('hdplay');

    // Если все битые, оставляем дефолтный порядок
    if (newPriority.length === 0) {
        log('warning', '⚠️ All TikTok URLs are invalid! Keeping default priority.');
        newPriority.push('play', 'wmplay', 'hdplay');
    }

    // Сравниваем с текущим приоритетом
    const priorityChanged = JSON.stringify(newPriority) !== JSON.stringify(currentPriority);

    if (priorityChanged) {
        const oldPriority = currentPriority.join(' > ');
        currentPriority = newPriority;
        savePriority(newPriority);

        log('warning', `🔄 TikTok priority changed!`);
        log('warning', `   Old: ${oldPriority}`);
        log('warning', `   New: ${newPriority.join(' > ')}`);

        // Отправляем уведомление администратору
        if (bot && config.ADMIN_ID) {
            try {
                const message =
                    `🔄 *TikTok API Priority Changed*\n\n` +
                    `⚠️ Автоматическая проверка обнаружила изменения в работе TikTok API\\.\n\n` +
                    `🔴 Старый приоритет:\n\`${oldPriority.replace(/>/g, '\\>')}\`\n\n` +
                    `🟢 Новый приоритет:\n\`${newPriority.join(' > ').replace(/>/g, '\\>')}\`\n\n` +
                    `📊 Результаты проверки:\n` +
                    `• play: ${results.play?.valid ? '✅' : '❌'} ${results.play?.size ? `(${(results.play.size / 1024 / 1024).toFixed(2)} MB)` : ''}\n` +
                    `• wmplay: ${results.wmplay?.valid ? '✅' : '❌'} ${results.wmplay?.size ? `(${(results.wmplay.size / 1024 / 1024).toFixed(2)} MB)` : ''}\n` +
                    `• hdplay: ${results.hdplay?.valid ? '✅' : '❌'} ${results.hdplay?.size ? `(${(results.hdplay.size / 1024 / 1024).toFixed(2)} MB)` : ''}\n\n` +
                    `🕐 ${new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}`;

                await bot.telegram.sendMessage(config.ADMIN_ID, message, { parse_mode: 'MarkdownV2' });
                log('success', 'Priority change notification sent to admin');
            } catch (error) {
                log('error', `Failed to send notification to admin: ${error.message}`);
            }
        }
    } else {
        log('success', `✅ TikTok API healthcheck passed. Priority unchanged: ${currentPriority.join(' > ')}`);
    }

    // Логируем детальные результаты
    log('info', '📊 Healthcheck results:');
    for (const [type, result] of Object.entries(results)) {
        log('info', `   ${type}: ${result.valid ? '✅ Valid' : '❌ Invalid'} (${(result.size / 1024 / 1024).toFixed(2)} MB) ${result.reason || ''}`);
    }
}

// Получить текущий приоритет
function getCurrentPriority() {
    return currentPriority;
}

// Инициализация
loadPriority();

module.exports = {
    runHealthcheck,
    getCurrentPriority,
    loadPriority
};
