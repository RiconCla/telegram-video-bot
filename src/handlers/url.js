const { Input } = require('telegraf');
const { Markup } = require('telegraf');
const { log } = require('../utils/logger');
const { validateUrl } = require('../middleware/validation');
const { downloadTiktok } = require('../services/tiktok');
const { downloadInstagram } = require('../services/instagram');
const { downloadMediaFile } = require('../services/downloader');
const { getLocale } = require('../utils/i18n');
const config = require('../../config/config');
const fs = require('fs');
const { trackUser } = require('../utils/analytics');
const { compressVideo } = require('../utils/compressor');

async function handleUrl(ctx, userState) {
    const userId = ctx.from.id;
    const messageText = ctx.message.text.trim();
    const username = ctx.from.username || ctx.from.first_name || 'Unknown';
    const messages = getLocale(userId);

    trackUser(userId, username);

    // Если пользователь ещё не активировал бота
    if (userState !== 'active') {
        log('warning', 'User sent message without activating bot', userId);
        await ctx.reply(
            messages.NOT_ACTIVATED,
            Markup.keyboard([
                [messages.LAUNCH_BUTTON]
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
                await handleVideo(ctx, result, validation, userId, loadingMsg, messages);
            } else if (result.type === 'image' || Array.isArray(result.url)) {
                await handleImages(ctx, result, validation, userId, loadingMsg, messages);
            }

            log('success', 'Media sent successfully', userId);
            await ctx.reply(messages.SEND_NEW_LINK);

        } else {
            await editMessage(ctx, loadingMsg, '❌');
            log('error', 'Failed to download media', userId);
            await ctx.reply(messages.DOWNLOAD_ERROR);
        }
    } catch (error) {
        log('error', `Processing error: ${error.message}`, userId);
        await editMessage(ctx, loadingMsg, '❌');
        await ctx.reply(messages.PROCESSING_ERROR);
    }
}

async function handleVideo(ctx, result, validation, userId, loadingMsg, messages) {
    log('info', 'Sending video to user', userId);

    let finalPath;
    if (validation.isInstagram) {
        finalPath = await compressVideo(result.url, userId);
        if (finalPath !== result.url && fs.existsSync(result.url)) {
            fs.unlinkSync(result.url);
        }
    } else {
        const videoPath = await downloadMediaFile(result.url, userId, 'video.mp4');
        finalPath = await compressVideo(videoPath, userId);
        if (finalPath !== videoPath && fs.existsSync(videoPath)) {
            fs.unlinkSync(videoPath);
        }
    }

    await editMessage(ctx, loadingMsg, messages.SENDING_VIDEO);
    const startTime = Date.now();
    await ctx.replyWithVideo(
        Input.fromLocalFile(finalPath),
        { caption: messages.VIDEO_DOWNLOADED }
    );

    const uploadTime = ((Date.now() - startTime) / 1000).toFixed(2);
    log('success', `Video sent successfully in ${uploadTime}s`, userId);
}

async function handleImages(ctx, result, validation, userId, loadingMsg, messages) {
    if (Array.isArray(result.url)) {
        await handleImageCarousel(ctx, result, validation, userId, loadingMsg, messages);
    } else {
        await handleSingleImage(ctx, result, validation, userId, loadingMsg, messages);
    }
}

async function handleImageCarousel(ctx, result, validation, userId, loadingMsg, messages) {
    const totalImages = result.url.length;
    log('info', `Sending ${totalImages} images to user as media groups`, userId);

    try {
        await editMessage(ctx, loadingMsg, messages.sendingImages(totalImages));

        const batches = Math.ceil(totalImages / config.BATCH_SIZE);
        let totalSent = 0;

        for (let batch = 0; batch < batches; batch++) {
            const startIndex = batch * config.BATCH_SIZE;
            const endIndex = Math.min(startIndex + config.BATCH_SIZE, totalImages);
            const batchItems = result.url.slice(startIndex, endIndex);

            log('info', `Processing batch ${batch + 1}/${batches} (images ${startIndex + 1}-${endIndex})`, userId);

            const imagePaths = [];
            for (let i = 0; i < batchItems.length; i++) {
                try {
                    let imagePath;
                    if (validation.isInstagram) {
                        imagePath = batchItems[i];
                    } else {
                        imagePath = await downloadMediaFile(
                            batchItems[i],
                            userId,
                            `batch${batch}_image_${i}.jpg`
                        );
                    }
                    imagePaths.push(imagePath);
                } catch (downloadError) {
                    log('error', `Failed to get image ${startIndex + i}: ${downloadError.message}`, userId);
                }
            }

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

                for (const p of imagePaths) {
                    try {
                        if (fs.existsSync(p)) {
                            fs.unlinkSync(p);
                            log('info', `Deleted temp file: ${p.split('/').pop()}`, userId);
                        }
                    } catch (deleteError) {
                        log('warning', `Could not delete file: ${p}`, userId);
                    }
                }
            }

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

async function handleSingleImage(ctx, result, validation, userId, loadingMsg, messages) {
    log('info', 'Sending single image to user', userId);

    let imagePath;
    if (validation.isInstagram) {
        imagePath = result.url;
    } else {
        imagePath = await downloadMediaFile(result.url, userId, 'image.jpg');
    }

    await editMessage(ctx, loadingMsg, messages.sendingImage());
    await ctx.replyWithPhoto(
        Input.fromLocalFile(imagePath),
        { caption: messages.IMAGE_DOWNLOADED }
    );
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
