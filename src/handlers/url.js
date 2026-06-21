const { Input } = require('telegraf');
const { Markup } = require('telegraf');
const { log } = require('../utils/logger');
const { validateUrl } = require('../middleware/validation');
const { downloadViaYtdlp } = require('../services/ytdlp');
const { getLocale, hasNoAskLang, getUserLanguage } = require('../utils/i18n');
const {
    checkSubscription,
    buildSubscriptionKeyboard,
    pickRequiredText
} = require('../middleware/subscription');
const config = require('../../config/config');
const fs = require('fs');
const { trackUser } = require('../utils/analytics');
const { compressVideo, getVideoMeta } = require('../utils/compressor');
const { markPending } = require('../utils/pendingSubscriptions');
// ── autoposter integration ──
const { prepareBatch, isEnabled: isForwardEnabled } = require('../services/forwardQueue');

async function handleUrl(ctx, isActive) {
    const userId = ctx.from.id;
    const messageText = ctx.message.text.trim();
    const username = ctx.from.username || ctx.from.first_name || 'Unknown';
    const messages = getLocale(userId);

    trackUser(userId, username);

    if (!isActive) {
        log('warning', 'User sent message without activating bot', userId);
        await ctx.reply(
            messages.NOT_ACTIVATED,
            Markup.keyboard([[messages.LAUNCH_BUTTON]]).resize()
        );
        return;
    }

    const { ok, missing } = await checkSubscription(ctx);
    if (!ok) {
        log('warning', 'User not subscribed to required channel(s)', userId);
        markPending(userId, getUserLanguage(userId));
        await ctx.reply(
            pickRequiredText(messages, missing),
            buildSubscriptionKeyboard(messages, missing)
        );
        return;
    }

    log('info', `Received URL: ${messageText}`, userId);

    const validation = validateUrl(messageText);
    if (!validation.isSupported) {
        log('warning', 'Invalid URL received', userId);
        await ctx.reply(messages.INVALID_URL);
        return;
    }

    const loadingMsg = await ctx.reply(messages.LOADING);
    log('info', 'Download started', userId);

    try {
        const result = await downloadViaYtdlp(messageText, userId);

        if (result.success) {
            // forwardItems заполняется handle*-функциями — список локальных файлов
            const forwardItems = [];

            if (result.type === 'video') {
                await handleVideo(ctx, result, userId, loadingMsg, messages, forwardItems);
            } else if (result.type === 'mixed') {
                await handleMixed(ctx, result, userId, loadingMsg, messages, forwardItems);
            } else if (result.type === 'image' || Array.isArray(result.url)) {
                await handleImages(ctx, result, userId, loadingMsg, messages, forwardItems);
            }

            log('success', 'Media sent successfully', userId);

            // Спрашиваем про автопостер только если форвард включён И это сам владелец.
            // prepareBatch копирует файлы в shared volume СРАЗУ — переживут штатный cleanup.
            if (isForwardEnabled() && forwardItems.length > 0) {
                const token = prepareBatch({
                    userId,
                    sourceUrl: messageText,
                    items: forwardItems,
                });
                if (token) {
                    await ctx.reply(
                        '➕ Добавить в очередь паблика?',
                        Markup.inlineKeyboard([
                            [
                                Markup.button.callback('✅ Да', `fwd:y:${token}`),
                                Markup.button.callback('❌ Нет', `fwd:n:${token}`),
                            ],
                        ])
                    );
                }
            }

            const sendNewLinkExtra = hasNoAskLang(userId)
                ? {}
                : Markup.inlineKeyboard([[
                    Markup.button.callback(messages.CHANGE_LANGUAGE_BUTTON, 'lang_change_menu')
                ]]);
            await ctx.reply(messages.SEND_NEW_LINK, sendNewLinkExtra);

        } else {
            await editMessage(ctx, loadingMsg, '❌');
            log('error', `Failed to download media (reason: ${result.reason || 'generic'})`, userId);
            const errMsg = result.reason === 'restricted' ? messages.RESTRICTED_ERROR
                : result.reason === 'private' ? messages.PRIVATE_ERROR
                : result.reason === 'unavailable' ? messages.UNAVAILABLE_ERROR
                : messages.DOWNLOAD_ERROR;
            await ctx.reply(errMsg);
        }
    } catch (error) {
        log('error', `Processing error: ${error.message}`, userId);
        await editMessage(ctx, loadingMsg, '❌');
        await ctx.reply(messages.PROCESSING_ERROR);
    }
}

async function handleVideo(ctx, result, userId, loadingMsg, messages, forwardItems) {
    log('info', 'Sending video to user', userId);

    const videoPath = result.url; // локальный файл, скачанный yt-dlp
    const finalPath = await compressVideo(videoPath, userId);
    if (finalPath !== videoPath && fs.existsSync(videoPath)) {
        fs.unlinkSync(videoPath);
    }

    // Даже после сжатия слишком большое (очень длинное видео) — лимит Telegram-бота 50MB
    if (fs.existsSync(finalPath) && fs.statSync(finalPath).size > 49.5 * 1024 * 1024) {
        log('warning', 'Video still exceeds Telegram 50MB limit after compression', userId);
        await editMessage(ctx, loadingMsg, '❌');
        await ctx.reply(messages.VIDEO_TOO_LARGE);
        if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath);
        return;
    }

    await editMessage(ctx, loadingMsg, messages.SENDING_VIDEO);
    const startTime = Date.now();
    const isAdmin = String(userId) === String(config.ADMIN_ID);
    const videoOpts = { caption: isAdmin ? undefined : messages.VIDEO_DOWNLOADED, supports_streaming: true };
    try {
        const meta = await getVideoMeta(finalPath);
        if (meta) {
            videoOpts.width = meta.width;
            videoOpts.height = meta.height;
            videoOpts.duration = meta.duration;
        }
    } catch (e) {
        log('warning', `Could not get video metadata: ${e.message}`, userId);
    }
    await ctx.replyWithVideo(Input.fromLocalFile(finalPath), videoOpts);

    if (Array.isArray(forwardItems) && fs.existsSync(finalPath)) {
        forwardItems.push({ path: finalPath, kind: 'video' });
    }

    const uploadTime = ((Date.now() - startTime) / 1000).toFixed(2);
    log('success', `Video sent successfully in ${uploadTime}s`, userId);
}

async function handleImages(ctx, result, userId, loadingMsg, messages, forwardItems) {
    if (Array.isArray(result.url)) {
        await handleImageCarousel(ctx, result, userId, loadingMsg, messages, forwardItems);
    } else {
        await handleSingleImage(ctx, result, userId, loadingMsg, messages, forwardItems);
    }
}

async function handleImageCarousel(ctx, result, userId, loadingMsg, messages, forwardItems) {
    const totalImages = result.url.length;
    log('info', `Sending ${totalImages} images to user as media groups`, userId);

    // ВАЖНО: один TikTok/Instagram пост = один пост в autoposter,
    // даже если карусель из 12+ фото шлётся пользователю несколькими media-groups.
    const allImagePaths = [];

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
                // batchItems[i] — локальный файл, скачанный yt-dlp/embed
                if (fs.existsSync(batchItems[i])) {
                    imagePaths.push(batchItems[i]);
                } else {
                    log('error', `Image file missing: ${batchItems[i]}`, userId);
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

                allImagePaths.push(...imagePaths);
            }

            if (batch < batches - 1) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

        if (Array.isArray(forwardItems)) {
            for (const p of allImagePaths) {
                if (fs.existsSync(p)) forwardItems.push({ path: p, kind: 'photo' });
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
    // Cleanup временных файлов делает штатный auto-cleanup бота (FILE_LIFETIME).
    // Если форвард в shared volume уже произошёл — копии в /data/ingest сохранятся.
}

async function handleSingleImage(ctx, result, userId, loadingMsg, messages, forwardItems) {
    log('info', 'Sending single image to user', userId);

    const imagePath = result.url; // локальный файл, скачанный yt-dlp/embed

    await editMessage(ctx, loadingMsg, messages.sendingImage());
    const isAdmin = String(userId) === String(config.ADMIN_ID);
    await ctx.replyWithPhoto(
        Input.fromLocalFile(imagePath),
        { caption: isAdmin ? undefined : messages.IMAGE_DOWNLOADED }
    );

    if (Array.isArray(forwardItems) && fs.existsSync(imagePath)) {
        forwardItems.push({ path: imagePath, kind: 'photo' });
    }
}

// Смешанная карусель (видео + фото) — например, Instagram carousel.
// Видео отправляем по одному (replyWithVideo), фото — группами media group.
// Один пост источника = один пост в autoposter (все элементы кладём в forwardItems).
async function handleMixed(ctx, result, userId, loadingMsg, messages, forwardItems) {
    const items = Array.isArray(result.items) ? result.items : [];
    log('info', `Sending mixed carousel (${items.length} items) to user`, userId);

    await editMessage(ctx, loadingMsg, messages.sendingImages(items.length));

    const photoPaths = [];

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        try {
            if (item.type === 'video') {
                const videoPath = item.url; // локальный файл от yt-dlp
                const finalPath = await compressVideo(videoPath, userId);
                if (finalPath !== videoPath && fs.existsSync(videoPath)) {
                    fs.unlinkSync(videoPath);
                }

                // Слишком большое после сжатия — пропускаем этот элемент карусели
                if (fs.existsSync(finalPath) && fs.statSync(finalPath).size > 49.5 * 1024 * 1024) {
                    log('warning', `Mixed item ${i} exceeds 50MB after compression — skipped`, userId);
                    if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath);
                    continue;
                }

                const videoOpts = { supports_streaming: true };
                try {
                    const meta = await getVideoMeta(finalPath);
                    if (meta) {
                        videoOpts.width = meta.width;
                        videoOpts.height = meta.height;
                        videoOpts.duration = meta.duration;
                    }
                } catch (e) {
                    log('warning', `Could not get video metadata: ${e.message}`, userId);
                }

                await ctx.replyWithVideo(Input.fromLocalFile(finalPath), videoOpts);
                if (Array.isArray(forwardItems) && fs.existsSync(finalPath)) {
                    forwardItems.push({ path: finalPath, kind: 'video' });
                }
            } else if (fs.existsSync(item.url)) {
                photoPaths.push(item.url); // локальный файл от yt-dlp
            }
        } catch (e) {
            log('error', `Mixed carousel item ${i} failed: ${e.message}`, userId);
        }
    }

    // Фото отправляем группами по BATCH_SIZE (Telegram: максимум 10 в media group)
    for (let start = 0; start < photoPaths.length; start += config.BATCH_SIZE) {
        const group = photoPaths
            .slice(start, start + config.BATCH_SIZE)
            .map((p) => ({ type: 'photo', media: Input.fromLocalFile(p) }));

        if (group.length === 1) {
            await ctx.replyWithPhoto(group[0].media);
        } else if (group.length > 1) {
            await ctx.replyWithMediaGroup(group);
        }
    }

    if (Array.isArray(forwardItems)) {
        for (const p of photoPaths) {
            if (fs.existsSync(p)) forwardItems.push({ path: p, kind: 'photo' });
        }
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
    } catch (e) { /* ignore */ }
}

module.exports = { handleUrl };
