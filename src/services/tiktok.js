const axios = require('axios');
const config = require('../../config/config');
const { log } = require('../utils/logger');

const VIDEO_URL_PRIORITY = ['play', 'wmplay', 'hdplay'];

async function downloadTiktok(url, userId) {
    try {
        log('info', `Starting TikTok download: ${url}`, userId);

        const response = await axios.post(config.TIKTOK_API_URL, {
            url: url,
            hd: 1
        }, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        if (response.data && response.data.code === 0) {
            const data = response.data.data;

            // СНАЧАЛА проверяем изображения (слайдшоу)
            if (data.images && Array.isArray(data.images) && data.images.length > 0) {
                log('success', `TikTok slideshow: ${data.images.length} images`, userId);
                return {
                    success: true,
                    type: 'image',
                    url: data.images,
                    thumbnail: data.cover
                };
            }

            let videoUrl = null;
            let videoType = null;

            // Проходим по приоритету и выбираем первый доступный URL
            for (const type of VIDEO_URL_PRIORITY) {
                if (data[type]) {
                    videoUrl = data[type];
                    videoType = type;
                    break;
                }
            }

            if (videoUrl) {
                log('success', `TikTok video download successful (${videoType})`, userId);
                log('info', `Video URL: ${videoUrl.substring(0, 100)}...`, userId);

                // Проверяем, что URL не пустой и начинается с http
                if (!videoUrl.startsWith('http')) {
                    log('error', `Invalid video URL: ${videoUrl}`, userId);
                    return { success: false };
                }

                return {
                    success: true,
                    type: 'video',
                    url: videoUrl,
                    thumbnail: data.cover
                };
            }

            // Если ничего не найдено
            log('warning', 'TikTok download failed: No valid media found in response', userId);
        }

        log('warning', 'TikTok download failed: Invalid API response', userId);
        return { success: false };

    } catch (error) {
        log('error', `TikTok download error: ${error.message}`, userId);
        return { success: false };
    }
}

module.exports = { downloadTiktok };
