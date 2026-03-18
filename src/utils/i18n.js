const en = require('../locales/en');
const ru = require('../locales/ru');

// Хранилище языков пользователей: userId -> 'en' | 'ru'
const userLanguages = new Map();

const locales = { en, ru };

/**
 * Получить локаль пользователя
 * @param {number|string} userId
 * @returns {object} locale messages
 */
function getLocale(userId) {
    const lang = userLanguages.get(String(userId)) || 'en';
    return locales[lang] || locales.en;
}

/**
 * Установить язык пользователя
 * @param {number|string} userId
 * @param {'en'|'ru'} lang
 */
function setLanguage(userId, lang) {
    if (locales[lang]) {
        userLanguages.set(String(userId), lang);
    }
}

/**
 * Получить язык пользователя
 * @param {number|string} userId
 * @returns {'en'|'ru'|null}
 */
function getUserLanguage(userId) {
    return userLanguages.get(String(userId)) || null;
}

/**
 * Проверить, выбрал ли пользователь язык
 * @param {number|string} userId
 * @returns {boolean}
 */
function hasLanguage(userId) {
    return userLanguages.has(String(userId));
}

module.exports = { getLocale, setLanguage, getUserLanguage, hasLanguage };
