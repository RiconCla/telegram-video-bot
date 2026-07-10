const axios = require('axios');
const config = require('../../config/config');
const { log } = require('../utils/logger');
const { downloadMediaFile } = require('./downloader');

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

// Адаптер под контракт downloadViaYtdlp: tikwm отдаёт удалённые URL,
// а обработчики url.js ждут локальные пути — докачиваем файлы сами.
//   { success:true, type:'video', url:'<local path>' }
//   { success:true, type:'image', url:['<local>', ...] }
//   { success:false }  — вызывающий код фоллбечится на yt-dlp
async function downloadTiktokAsFiles(url, userId) {
    const result = await downloadTiktok(url, userId);
    if (!result.success) {
        return { success: false };
    }

    try {
        if (result.type === 'video') {
            const localPath = await downloadMediaFile(result.url, userId, 'tiktok_video.mp4');
            return { success: true, type: 'video', url: localPath };
        }

        // Слайдшоу: качаем каждую картинку, неудачные пропускаем
        const localPaths = [];
        for (let i = 0; i < result.url.length; i++) {
            try {
                const imagePath = await downloadMediaFile(result.url[i], userId, `tiktok_image_${i}.jpg`);
                localPaths.push(imagePath);
            } catch (e) {
                log('warning', `TikTok slideshow image ${i + 1}/${result.url.length} failed: ${e.message}`, userId);
            }
        }

        if (localPaths.length === 0) {
            log('error', 'TikTok slideshow: no images could be downloaded', userId);
            return { success: false };
        }

        return { success: true, type: 'image', url: localPaths };
    } catch (error) {
        log('error', `TikTok media download error: ${error.message}`, userId);
        return { success: false };
    }
}

module.exports = { downloadTiktok, downloadTiktokAsFiles };
