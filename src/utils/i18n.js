const fs = require('fs');
const path = require('path');
const en = require('../locales/en');
const ru = require('../locales/ru');

const USERS_FILE = path.join(__dirname, '../../data/users.json');

const locales = { en, ru };

// In-memory хранилища
const userLanguages = new Map(); // userId → 'en' | 'ru'
const userNoAsk = new Map();     // userId → true (если отказался от смены языка)
const userActive = new Map();    // userId → true (прошёл активацию)

// ─────────────────────────────────────────────
// Загрузка данных при старте
// ─────────────────────────────────────────────
function loadFromFile() {
    try {
        if (fs.existsSync(USERS_FILE)) {
            const data = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
            for (const [userId, prefs] of Object.entries(data)) {
                if (prefs.lang && locales[prefs.lang]) userLanguages.set(userId, prefs.lang);
                if (prefs.noAsk) userNoAsk.set(userId, true);
                if (prefs.active) userActive.set(userId, true);
            }
        }
    } catch (e) {
        // Файл отсутствует или повреждён — начинаем с чистого листа
    }
}

// ─────────────────────────────────────────────
// Сохранение с дебаунсом (100 мс)
// ─────────────────────────────────────────────
let saveTimer = null;

function saveToFile() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        try {
            const allUserIds = new Set([
                ...userLanguages.keys(),
                ...userNoAsk.keys(),
                ...userActive.keys()
            ]);
            const data = {};
            for (const userId of allUserIds) {
                data[userId] = {
                    lang: userLanguages.get(userId) || null,
                    noAsk: userNoAsk.get(userId) || false,
                    active: userActive.get(userId) || false
                };
            }
            fs.mkdirSync(path.dirname(USERS_FILE), { recursive: true });
            fs.writeFileSync(USERS_FILE, JSON.stringify(data, null, 2));
        } catch (e) {
            // Игнорируем ошибки записи
        }
    }, 100);
}

// Инициализация при загрузке модуля
loadFromFile();

// ─────────────────────────────────────────────
// Язык пользователя
// ─────────────────────────────────────────────

function getLocale(userId) {
    const lang = userLanguages.get(String(userId)) || 'en';
    return locales[lang] || locales.en;
}

function setLanguage(userId, lang) {
    if (locales[lang]) {
        userLanguages.set(String(userId), lang);
        saveToFile();
    }
}

function getUserLanguage(userId) {
    return userLanguages.get(String(userId)) || null;
}

// ─────────────────────────────────────────────
// "Не спрашивать про смену языка"
// ─────────────────────────────────────────────

function hasNoAskLang(userId) {
    return userNoAsk.get(String(userId)) === true;
}

function setNoAskLang(userId) {
    userNoAsk.set(String(userId), true);
    saveToFile();
}

// ─────────────────────────────────────────────
// Состояние активации пользователя
// ─────────────────────────────────────────────

function isUserActive(userId) {
    return userActive.get(String(userId)) === true;
}

function setUserActive(userId) {
    userActive.set(String(userId), true);
    saveToFile();
}

module.exports = {
    getLocale,
    setLanguage,
    getUserLanguage,
    hasNoAskLang,
    setNoAskLang,
    isUserActive,
    setUserActive
};
