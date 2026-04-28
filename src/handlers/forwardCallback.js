/**
 * Регистрация callback-обработчика для инлайн-кнопок «Да/Нет».
 * Подключается в bot.js одной строкой:
 *
 *   const { register: registerForwardCallback } = require('./src/handlers/forwardCallback');
 *   registerForwardCallback(bot);
 */
const fs = require('fs');
const { log } = require('../utils/logger');
const config = require('../../config/config');
const { confirm, discard } = require('../services/forwardQueue');
const { postToAutoposter } = require('../services/forwarder');

function register(bot) {
    bot.action(/^fwd:(y|n):(.+)$/, async (ctx) => {
        const action = ctx.match[1];
        const token = ctx.match[2];
        const userId = ctx.from?.id;

        // Только владелец может управлять очередью паблика
        if (String(userId) !== String(config.FORWARD_USER_ID)) {
            await ctx.answerCbQuery('Не для вас');
            return;
        }

        if (action === 'n') {
            const ok = discard(token);
            await safeEdit(ctx, ok ? '🚫 Не добавлено' : '⌛ Истекло');
            await ctx.answerCbQuery();
            return;
        }

        // action === 'y'
        const entry = confirm(token);
        if (!entry) {
            await safeEdit(ctx, '⌛ Истекло (>1ч) или уже обработано');
            await ctx.answerCbQuery();
            return;
        }

        await safeEdit(ctx, '⏳ Отправляю в очередь паблика...');
        try {
            const data = await postToAutoposter(entry);
            await safeEdit(ctx, formatResponse(data));
        } catch (e) {
            const status = e.response?.status;
            const detail = e.response?.data
                ? JSON.stringify(e.response.data)
                : e.message;
            log('error', `forward POST failed: ${status || ''} ${detail}`, userId);
            await safeEdit(ctx, `❌ Ошибка: ${status || ''} ${detail}`);
            // Файлы остались в shared volume — autoposter их подберёт через cleanup_orphan_ingest (24ч)
            try { fs.rmSync(entry.targetDir, { recursive: true, force: true }); } catch {}
        }
        await ctx.answerCbQuery();
    });
}

function formatResponse(data) {
    if (!data) return '⚠️ Пустой ответ';
    if (data.status === 'created') {
        return `✅ В очереди паблика (post_id=${data.post_id})`;
    }
    if (data.status === 'duplicate') {
        const dup = data.duplicate || {};
        const reason = dup.reason || 'unknown';
        const dist = dup.distance != null ? `, distance=${dup.distance}` : '';
        return `♻️ Дубль (${reason}${dist})`;
    }
    return `⚠️ ${JSON.stringify(data)}`;
}

async function safeEdit(ctx, text) {
    try {
        await ctx.editMessageText(text);
    } catch (e) {
        // если сообщение слишком старое или уже отредактировано — игнор
    }
}

module.exports = { register };
