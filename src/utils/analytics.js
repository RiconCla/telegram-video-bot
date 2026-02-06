const { log } = require('./logger');

// Хранилище статистики пользователей (в памяти)
// В production лучше использовать базу данных
const userStats = new Map();
const dailyUsers = new Set();
const weeklyUsers = new Set();
const monthlyUsers = new Set();

// Статистика по дням
const statsHistory = {
    daily: [],
    weekly: [],
    monthly: []
};

// Добавить пользователя в статистику
function trackUser(userId, username) {
    const now = new Date();
    const userKey = userId.toString();

    // Инициализируем пользователя, если его нет
    if (!userStats.has(userKey)) {
        userStats.set(userKey, {
            userId: userId,
            username: username || 'Unknown',
            firstSeen: now,
            lastSeen: now,
            totalRequests: 0,
            dailyRequests: 0,
            weeklyRequests: 0,
            monthlyRequests: 0
        });
        log('info', `New user tracked: @${username || userId}`, userId);
    }

    // Обновляем статистику
    const user = userStats.get(userKey);
    user.lastSeen = now;
    user.totalRequests++;
    user.dailyRequests++;
    user.weeklyRequests++;
    user.monthlyRequests++;

    // Добавляем в активные наборы
    dailyUsers.add(userKey);
    weeklyUsers.add(userKey);
    monthlyUsers.add(userKey);

    log('info', `User activity tracked: @${user.username}, total requests: ${user.totalRequests}`, userId);
}

// Получить статистику за период
function getStats(period = 'daily') {
    let activeUsers;
    let userList = [];

    switch (period) {
        case 'daily':
            activeUsers = dailyUsers.size;
            dailyUsers.forEach(userKey => {
                const user = userStats.get(userKey);
                if (user) {
                    userList.push({
                        username: user.username,
                        requests: user.dailyRequests
                    });
                }
            });
            break;
        case 'weekly':
            activeUsers = weeklyUsers.size;
            weeklyUsers.forEach(userKey => {
                const user = userStats.get(userKey);
                if (user) {
                    userList.push({
                        username: user.username,
                        requests: user.weeklyRequests
                    });
                }
            });
            break;
        case 'monthly':
            activeUsers = monthlyUsers.size;
            monthlyUsers.forEach(userKey => {
                const user = userStats.get(userKey);
                if (user) {
                    userList.push({
                        username: user.username,
                        requests: user.monthlyRequests
                    });
                }
            });
            break;
    }

    // Сортируем по количеству запросов (от большего к меньшему)
    userList.sort((a, b) => b.requests - a.requests);

    return {
        period: period,
        activeUsers: activeUsers,
        totalUsers: userStats.size,
        userList: userList
    };
}

// Сброс статистики за период
function resetStats(period) {
    switch (period) {
        case 'daily':
            // Сохраняем в историю перед сбросом
            const dailyStats = getStats('daily');
            statsHistory.daily.push({
                date: new Date(),
                stats: dailyStats
            });

            // Сбрасываем счётчики
            userStats.forEach(user => {
                user.dailyRequests = 0;
            });
            dailyUsers.clear();
            log('info', `Daily stats reset. ${dailyStats.activeUsers} users tracked.`);
            break;

        case 'weekly':
            const weeklyStats = getStats('weekly');
            statsHistory.weekly.push({
                date: new Date(),
                stats: weeklyStats
            });

            userStats.forEach(user => {
                user.weeklyRequests = 0;
            });
            weeklyUsers.clear();
            log('info', `Weekly stats reset. ${weeklyStats.activeUsers} users tracked.`);
            break;

        case 'monthly':
            const monthlyStats = getStats('monthly');
            statsHistory.monthly.push({
                date: new Date(),
                stats: monthlyStats
            });

            userStats.forEach(user => {
                user.monthlyRequests = 0;
            });
            monthlyUsers.clear();
            log('info', `Monthly stats reset. ${monthlyStats.activeUsers} users tracked.`);
            break;
    }

    // Ограничиваем историю (храним только последние 30 записей)
    if (statsHistory[period].length > 30) {
        statsHistory[period] = statsHistory[period].slice(-30);
    }
}

// Получить полную статистику
function getAllStats() {
    return {
        daily: getStats('daily'),
        weekly: getStats('weekly'),
        monthly: getStats('monthly'),
        totalUsers: userStats.size
    };
}

module.exports = {
    trackUser,
    getStats,
    resetStats,
    getAllStats
};
