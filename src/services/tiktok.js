const axios = require('axios');
const config = require('../../config/config');
const { log } = require('../utils/logger');

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

            // ПОТОМ проверяем видео
            if (data.play) {
                log('success', 'TikTok video download successful', userId);
                log('info', `Video URL: ${data.play.substring(0, 100)}...`, userId);
                return {
                    success: true,
                    type: 'video',
                    url: data.hdplay || data.play,
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

module.exports = { downloadTiktok };
