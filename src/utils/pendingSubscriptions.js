const fs = require('fs');
const path = require('path');
const { log } = require('./logger');

const PENDING_FILE = path.resolve(__dirname, '../../data/pending-subscriptions.json');

let pending = {};

// Загрузка при старте
try {
    if (fs.existsSync(PENDING_FILE)) {
        pending = JSON.parse(fs.readFileSync(PENDING_FILE, 'utf-8'));
    }
} catch (e) {
    log('error', `Failed to load pending subscriptions: ${e.message}`);
}

function save() {
    try {
        const dir = path.dirname(PENDING_FILE);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(PENDING_FILE, JSON.stringify(pending, null, 2), 'utf-8');
    } catch (e) {
        log('error', `Failed to save pending subscriptions: ${e.message}`);
    }
}

// Идемпотентно: если юзер уже в pending — сохраняем addedAt / remindersSent
// (не сбрасываем отсчёт эскалации при повторных попытках), обновляем только lang.
function markPending(userId, lang) {
    const key = String(userId);
    const now = new Date().toISOString();
    const existing = pending[key];
    if (existing) {
        pending[key] = { ...existing, lang };
    } else {
        pending[key] = { addedAt: now, lastReminder: null, remindersSent: 0, lang };
    }
    save();
}

// Фиксируем факт отправки напоминания: инкремент счётчика + время.
function recordReminder(userId) {
    const key = String(userId);
    if (!pending[key]) return;
    pending[key].remindersSent = (pending[key].remindersSent || 0) + 1;
    pending[key].lastReminder = new Date().toISOString();
    save();
}

function removePending(userId) {
    const key = String(userId);
    if (pending[key]) {
        delete pending[key];
        save();
    }
}

function getPendingUsers() {
    return Object.entries(pending).map(([userId, data]) => {
        // Нормализация старых записей (без addedAt/remindersSent)
        const addedAt = data.addedAt
            ? new Date(data.addedAt)
            : (data.lastReminder ? new Date(data.lastReminder) : new Date());
        return {
            userId: Number(userId),
            addedAt,
            lastReminder: data.lastReminder ? new Date(data.lastReminder) : null,
            remindersSent: data.remindersSent || 0,
            lang: data.lang
        };
    });
}

module.exports = { markPending, recordReminder, removePending, getPendingUsers };
