const { Input } = require('telegraf');
const { log } = require('../utils/logger');
const { validateUrl } = require('../middleware/validation');
const { downloadTiktok } = require('../services/tiktok');
const { downloadInstagram } = require('../services/instagram');
const { downloadMediaFile } = require('../services/downloader');
const messages = require('../utils/messages');
const config = require('../../config/config');
const fs = require('fs');
const { trackUser } = require('../utils/analytics');
const { compressVideo } = require('../utils/compressor');

async function handleUrl(ctx, userState) {
    const userId = ctx.from.id;
    const messageText = ctx.message.text.trim();
    const username = ctx.from.username || ctx.from.first_name || 'Unknown';
    trackUser(userId, username);

    // Если пользователь еще не активировал бота
    if (userState !== 'active') {
        log('warning', 'User sent message without activating bot', userId);
        const { Markup } = require('telegraf');
        await ctx.reply(
            messages.NOT_ACTIVATED,
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
        await ctx.reply(messages.INVALID_URL);
        return;
    }

    // Показываем сообщение о загрузке
    const loadingMsg = await ctx.reply(messages.LOADING);
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
                await handleVideo(ctx, result, validation, userId, loadingMsg);
            } else if (result.type === 'image' || Array.isArray(result.url)) {
                await handleImages(ctx, result, validation, userId, loadingMsg);
            }

            log('success', 'Media sent successfully', userId);
            await ctx.reply(messages.SEND_NEW_LINK);

        } else {
            await editMessage(ctx, loadingMsg, '❌ Ошибка загрузки');
            log('error', 'Failed to download media', userId);
            await ctx.reply(messages.DOWNLOAD_ERROR);
        }
    } catch (error) {
        log('error', `Processing error: ${error.message}`, userId);
        await editMessage(ctx, loadingMsg, '❌ Произошла ошибка');
        await ctx.reply(messages.PROCESSING_ERROR);
    }
}

async function handleVideo(ctx, result, validation, userId, loadingMsg) {
    log('info', 'Sending video to user', userId);

    try {
        // Определяем, нужен ли прокси (для Instagram всегда, для TikTok - попробуем без)
        const useProxy = validation.isInstagram;

        log('info', `Downloading video (proxy: ${useProxy})`, userId);
        const videoPath = await downloadMediaFile(result.url, userId, 'video.mp4', useProxy);
        const finalPath = await compressVideo(videoPath, userId);
// Удаляем оригинал если он был сжат
        if (finalPath !== videoPath && fs.existsSync(videoPath)) {
            fs.unlinkSync(videoPath);
        }
        await editMessage(ctx, loadingMsg, messages.SENDING_VIDEO);
        const startTime = Date.now();
        await ctx.replyWithVideo(
            Input.fromLocalFile(finalPath),
            { caption: messages.VIDEO_DOWNLOADED }
        );

        const uploadTime = ((Date.now() - startTime) / 1000).toFixed(2);
        log('success', `Video sent successfully in ${uploadTime}s`, userId);

    } catch (sendError) {
        log('error', `Failed to send video: ${sendError.message}`, userId);

        // Если первая попытка не удалась и это был TikTok без прокси
        if (validation.isTiktok && !validation.isInstagram) {
            log('warning', 'Trying to re-download TikTok video through proxy...', userId);
            try {
                // Удаляем старый файл если есть
                const oldPath = `${config.TEMP_DIR}/${userId}_*_video.mp4`;
                const { execSync } = require('child_process');
                try {
                    execSync(`rm -f ${oldPath}`);
                } catch (e) {}

                // Пробуем скачать через прокси
                const videoPath = await downloadMediaFile(result.url, userId, 'video_proxy.mp4', true);
                const finalPath = await compressVideo(videoPath, userId);
                if (finalPath !== videoPath && fs.existsSync(videoPath)) {
                    fs.unlinkSync(videoPath);
                }
                await editMessage(ctx, loadingMsg, messages.SENDING_VIDEO);
                const startTime = Date.now();
                await ctx.replyWithVideo(
                    Input.fromLocalFile(finalPath),
                    { caption: messages.VIDEO_DOWNLOADED }
                );

                const uploadTime = ((Date.now() - startTime) / 1000).toFixed(2);
                log('success', `Video sent successfully in ${uploadTime}s (via proxy)`, userId);
                return;
            } catch (proxyError) {
                log('error', `Proxy attempt also failed: ${proxyError.message}`, userId);
            }
        }

        throw sendError;
    }
}



async function handleImages(ctx, result, validation, userId, loadingMsg) {
    if (Array.isArray(result.url)) {
        await handleImageCarousel(ctx, result, validation, userId, loadingMsg);
    } else {
        await handleSingleImage(ctx, result, validation, userId, loadingMsg);
    }
}

async function handleImageCarousel(ctx, result, validation, userId, loadingMsg) {
    const totalImages = result.url.length;
    log('info', `Sending ${totalImages} images to user as media groups`, userId);

    try {
        await editMessage(ctx, loadingMsg, messages.sendingImages(totalImages));

        const batches = Math.ceil(totalImages / config.BATCH_SIZE);
        let totalSent = 0;

        const useProxyForImages = validation.isInstagram;
        log('info', `Using proxy for images: ${useProxyForImages}`, userId);

        for (let batch = 0; batch < batches; batch++) {
            const startIndex = batch * config.BATCH_SIZE;
            const endIndex = Math.min(startIndex + config.BATCH_SIZE, totalImages);
            const batchUrls = result.url.slice(startIndex, endIndex);

            log('info', `Processing batch ${batch + 1}/${batches} (images ${startIndex + 1}-${endIndex})`, userId);

            // Скачиваем изображения
            const imagePaths = [];
            for (let i = 0; i < batchUrls.length; i++) {
                try {
                    const imageUrl = batchUrls[i];
                    const imagePath = await downloadMediaFile(
                        imageUrl,
                        userId,
                        `batch${batch}_image_${i}.jpg`,
                        useProxyForImages
                    );
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
                    caption: (batch === 0 && index === 0)
                        ? messages.imagesDownloaded(totalImages, batch + 1, batches)
                        : (batch > 0 && index === 0)
                            ? messages.batchPart(batch + 1, batches)
                            : undefined
                }));

                await ctx.replyWithMediaGroup(mediaGroup);
                totalSent += imagePaths.length;
                log('success', `Sent batch ${batch + 1}: ${imagePaths.length} images`, userId);

                // Удаляем файлы после отправки
                for (const path of imagePaths) {
                    try {
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
}

async function handleSingleImage(ctx, result, validation, userId, loadingMsg) {
    log('info', 'Sending single image to user', userId);

    try {
        const useProxy = validation.isInstagram;
        const imagePath = await downloadMediaFile(result.url, userId, 'image.jpg', useProxy);

        await editMessage(ctx, loadingMsg, messages.sendingImage());

        await ctx.replyWithPhoto(
            Input.fromLocalFile(imagePath),
            { caption: messages.IMAGE_DOWNLOADED }
        );
    } catch (sendError) {
        log('error', `Failed to send image: ${sendError.message}`, userId);
        throw sendError;
    }
}

async function editMessage(ctx, message, text) {
    try {
        await ctx.telegram.editMessageText(
            ctx.chat.id,
            message.message_id,
            null,
            text
        );
    } catch (e) {
        // Игнорируем ошибки редактирования
    }
}

module.exports = { handleUrl };
