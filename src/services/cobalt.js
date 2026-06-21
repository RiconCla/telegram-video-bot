const axios = require('axios');
const config = require('../../config/config');
const { log } = require('../utils/logger');

// Расширения фото — для определения image/video в ответах tunnel/redirect
const PHOTO_EXT = /\.(jpe?g|png|webp|heic|heif|gif|bmp)$/i;

function isPhotoName(name) {
    return typeof name === 'string' ? PHOTO_EXT.test(name) : false;
}

/**
 * Скачивание медиа через self-hosted cobalt API.
 * Возвращает результат в контракте, который понимает src/handlers/url.js:
 *   { success:true, type:'video', url:'<remote>' }            — одиночное видео
 *   { success:true, type:'image', url:'<remote>' }            — одиночное фото
 *   { success:true, type:'image', url:['<remote>', ...] }     — карусель только из фото
 *   { success:true, type:'mixed', items:[{type,url}, ...] }   — карусель видео+фото
 *   { success:false }                                         — ошибка
 */
async function downloadViaCobalt(url, userId) {
    try {
        log('info', `Starting cobalt download: ${url}`, userId);

        const headers = {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        };
        if (config.COBALT_API_KEY) {
            headers['Authorization'] = `Api-Key ${config.COBALT_API_KEY}`;
        }

        const response = await axios.post(
            config.COBALT_API_URL,
            {
                url,
                videoQuality: '1080',
                downloadMode: 'auto',
                filenameStyle: 'basic'
            },
            { headers, timeout: 60000 }
        );

        const data = response.data || {};
        const status = data.status;

        // Одиночное медиа: cobalt отдаёт готовый URL (туннель или внешний редирект)
        if (status === 'tunnel' || status === 'redirect') {
            if (!data.url || !String(data.url).startsWith('http')) {
                log('error', `cobalt ${status}: invalid media url`, userId);
                return { success: false };
            }
            const type = isPhotoName(data.filename) ? 'image' : 'video';
            log('success', `cobalt ${status}: single ${type}`, userId);
            return { success: true, type, url: data.url };
        }

        // Карусель / слайдшоу
        if (status === 'picker') {
            const picker = Array.isArray(data.picker)
                ? data.picker.filter((p) => p && p.url)
                : [];

            if (picker.length === 0) {
                log('warning', 'cobalt picker: empty', userId);
                return { success: false };
            }

            const hasVideo = picker.some((p) => p.type === 'video');

            if (!hasVideo) {
                // Только фото/gif (типичный TikTok-слайдшоу). Фоновое audio игнорируем.
                log('success', `cobalt picker: ${picker.length} photo(s)`, userId);
                return { success: true, type: 'image', url: picker.map((p) => p.url) };
            }

            const items = picker.map((p) => ({
                type: p.type === 'video' ? 'video' : 'photo',
                url: p.url
            }));
            log('success', `cobalt picker: mixed carousel (${items.length} items)`, userId);
            return { success: true, type: 'mixed', items };
        }

        if (status === 'error') {
            const code = data.error && data.error.code;
            log('error', `cobalt error: ${code || 'unknown'}`, userId);
            return { success: false };
        }

        // Не ожидается при localProcessing=disabled (по умолчанию), но обрабатываем мягко
        if (status === 'local-processing') {
            log('warning', 'cobalt returned local-processing (unexpected) — skipping', userId);
            return { success: false };
        }

        log('warning', `cobalt: unexpected status "${status}"`, userId);
        return { success: false };

    } catch (error) {
        const detail = error.response ? `HTTP ${error.response.status}` : error.message;
        log('error', `cobalt download error: ${detail}`, userId);
        return { success: false };
    }
}

module.exports = { downloadViaCobalt };
