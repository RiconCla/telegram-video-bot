const { Markup } = require('telegraf');
const { getLocale, setNoAskLang } = require('../utils/i18n');
const { log } = require('../utils/logger');

// ─────────────────────────────────────────────
// Общая клавиатура смены языка
// ─────────────────────────────────────────────
function getLangKeyboard(messages) {
    return Markup.inlineKeyboard([
        [
            Markup.button.callback('🇬🇧 English', 'lang_en'),
            Markup.button.callback('🇷🇺 Русский', 'lang_ru')
        ],
        [
            Markup.button.callback(messages.LANG_NO_ASK_BUTTON, 'lang_no_ask')
        ]
    ]);
}

// ─────────────────────────────────────────────
// /lang — команда смены языка
// ─────────────────────────────────────────────
async function handleLangCommand(ctx) {
    const userId = ctx.from.id;
    const messages = getLocale(userId);
    log('info', 'User opened language menu via /lang', userId);
    await ctx.reply(messages.LANG_MENU_TITLE, getLangKeyboard(messages));
}

// ─────────────────────────────────────────────
// Callback: кнопка "Сменить язык" в сообщениях
// ─────────────────────────────────────────────
async function handleLangChangeMenu(ctx) {
    const userId = ctx.from.id;
    const messages = getLocale(userId);
    await ctx.answerCbQuery();
    log('info', 'User opened language menu via inline button', userId);
    await ctx.editMessageText(messages.LANG_MENU_TITLE, getLangKeyboard(messages));
}

// ─────────────────────────────────────────────
// Callback: "Не спрашивать"
// ─────────────────────────────────────────────
async function handleNoAskLang(ctx) {
    const userId = ctx.from.id;
    const messages = getLocale(userId);
    await ctx.answerCbQuery();
    setNoAskLang(userId);
    log('info', 'User opted out of language prompts', userId);
    await ctx.editMessageText(messages.LANG_NO_ASK_CONFIRMED);
}

module.exports = { handleLangCommand, handleLangChangeMenu, handleNoAskLang };
