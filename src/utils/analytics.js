const { log } = require('./logger');
const fs = require('fs');
const path = require('path');

const STATS_FILE = path.resolve(__dirname, '../../data/stats.json');

// --- Персистентность ---
function ensureDataDir() {
    const dir = path.dirname(STATS_FILE);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function loadFromFile() {
    try {
        ensureDataDir();
        if (fs.existsSync(STATS_FILE)) {
            const data = JSON.parse(fs.readFileSync(STATS_FILE, 'utf-8'));
            const loadedStats = new Map(Object.entries(data.userStats || {}));
            loadedStats.forEach(user => {
                user.firstSeen = new Date(user.firstSeen);
                user.lastSeen = new Date(user.lastSeen);
            });
            return {
                userStats: loadedStats,
                dailyUsers: new Set(data.dailyUsers || []),
                weeklyUsers: new Set(data.weeklyUsers || []),
                monthlyUsers: new Set(data.monthlyUsers || []),
                statsHistory: data.statsHistory || { daily: [], weekly: [], monthly: [] }
            };
        }
    } catch (e) {
        log('error', `Failed to load stats from file: ${e.message}`);
    }
    return null;
}

function saveToFile() {
    try {
        ensureDataDir();
        const data = {
            userStats: Object.fromEntries(userStats),
            dailyUsers: [...dailyUsers],
            weeklyUsers: [...weeklyUsers],
            monthlyUsers: [...monthlyUsers],
            statsHistory
        };
        fs.writeFileSync(STATS_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
        log('error', `Failed to save stats to file: ${e.message}`);
    }
}

// --- Загрузка при старте ---
const saved = loadFromFile();
const userStats    = saved ? saved.userStats    : new Map();
const dailyUsers   = saved ? saved.dailyUsers   : new Set();
const weeklyUsers  = saved ? saved.weeklyUsers  : new Set();
const monthlyUsers = saved ? saved.monthlyUsers : new Set();
const statsHistory = saved ? saved.statsHistory : { daily: [], weekly: [], monthly: [] };

// --- Основные функции (без изменений логики, добавлен saveToFile) ---
function trackUser(userId, username) {
    const now = new Date();
    const userKey = userId.toString();

    if (!userStats.has(userKey)) {
        userStats.set(userKey, {
            userId, username: username || 'Unknown',
            firstSeen: now, lastSeen: now,
            totalRequests: 0,
            dailyRequests: 0, weeklyRequests: 0, monthlyRequests: 0
        });
        log('info', `New user tracked: @${username || userId}`, userId);
    }

    const user = userStats.get(userKey);
    user.lastSeen = now;
    user.totalRequests++;
    user.dailyRequests++;
    user.weeklyRequests++;
    user.monthlyRequests++;

    dailyUsers.add(userKey);
    weeklyUsers.add(userKey);
    monthlyUsers.add(userKey);

    log('info', `User activity tracked: @${user.username}, total: ${user.totalRequests}`, userId);
    saveToFile(); // 💾 Сохраняем после каждого трекинга
}

function getStats(period = 'daily') {
    let activeUsers;
    let userList = [];

    const sets = { daily: dailyUsers, weekly: weeklyUsers, monthly: monthlyUsers };
    const reqFields = { daily: 'dailyRequests', weekly: 'weeklyRequests', monthly: 'monthlyRequests' };

    activeUsers = sets[period].size;
    sets[period].forEach(userKey => {
        const user = userStats.get(userKey);
        if (user) userList.push({ username: user.username, requests: user[reqFields[period]] });
    });

    userList.sort((a, b) => b.requests - a.requests);
    return { period, activeUsers, totalUsers: userStats.size, userList };
}

function resetStats(period) {
    const stats = getStats(period);
    statsHistory[period].push({ date: new Date(), stats });

    const reqField = { daily: 'dailyRequests', weekly: 'weeklyRequests', monthly: 'monthlyRequests' }[period];
    const set = { daily: dailyUsers, weekly: weeklyUsers, monthly: monthlyUsers }[period];

    userStats.forEach(user => { user[reqField] = 0; });
    set.clear();

    if (statsHistory[period].length > 30) {
        statsHistory[period] = statsHistory[period].slice(-30);
    }

    log('info', `${period} stats reset. ${stats.activeUsers} users tracked.`);
    saveToFile(); // 💾 Сохраняем после сброса
}

function getAllStats() {
    return {
        daily: getStats('daily'),
        weekly: getStats('weekly'),
        monthly: getStats('monthly'),
        totalUsers: userStats.size
    };
}

module.exports = { trackUser, getStats, resetStats, getAllStats };
