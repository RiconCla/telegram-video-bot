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

function markPending(userId, lang) {
    const key = String(userId);
    pending[key] = { lastReminder: new Date().toISOString(), lang };
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
    return Object.entries(pending).map(([userId, data]) => ({
        userId: Number(userId),
        lastReminder: new Date(data.lastReminder),
        lang: data.lang
    }));
}

module.exports = { markPending, removePending, getPendingUsers };
