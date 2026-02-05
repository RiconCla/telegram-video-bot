const fs = require('fs');
const path = require('path');
const config = require('../../config/config');
const { log } = require('./logger');

// Создаем папку для временных файлов
if (!fs.existsSync(config.TEMP_DIR)) {
    fs.mkdirSync(config.TEMP_DIR, { recursive: true });
}

// Хранилище файлов пользователей
const userFiles = new Map();

// Добавление файла в очередь пользователя
function addUserFile(userId, filePath) {
    if (!userFiles.has(userId)) {
        userFiles.set(userId, []);
    }

    const files = userFiles.get(userId);

    // Если достигнут лимит, удаляем самый старый
    if (files.length >= config.MAX_FILES_PER_USER) {
        const oldestFile = files.shift();
        deleteFile(oldestFile.path, userId);

        if (oldestFile.timer) {
            clearTimeout(oldestFile.timer);
        }
    }

    // Создаем таймер на удаление
    const timer = setTimeout(() => {
        deleteFileFromUser(userId, filePath);
    }, config.FILE_LIFETIME);

    files.push({
        path: filePath,
        createdAt: Date.now(),
        timer: timer
    });

    log('info', `File added to queue. Total files: ${files.length}/${config.MAX_FILES_PER_USER}`, userId);
}

// Удаление файла из очереди пользователя
function deleteFileFromUser(userId, filePath) {
    if (!userFiles.has(userId)) return;

    const files = userFiles.get(userId);
    const index = files.findIndex(f => f.path === filePath);

    if (index !== -1) {
        const file = files[index];

        if (file.timer) {
            clearTimeout(file.timer);
        }

        deleteFile(filePath, userId);
        files.splice(index, 1);

        log('info', `File removed from queue (timeout). Remaining: ${files.length}`, userId);

        if (files.length === 0) {
            userFiles.delete(userId);
        }
    }
}

// Физическое удаление файла
function deleteFile(filePath, userId = null) {
    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            log('success', `File deleted: ${path.basename(filePath)}`, userId);
        }
    } catch (error) {
        log('error', `Failed to delete file: ${error.message}`, userId);
    }
}

// Очистка всех файлов пользователя
function clearUserFiles(userId) {
    if (!userFiles.has(userId)) return;

    const files = userFiles.get(userId);

    files.forEach(file => {
        if (file.timer) {
            clearTimeout(file.timer);
        }
        deleteFile(file.path, userId);
    });

    userFiles.delete(userId);
    log('info', 'All user files cleared', userId);
}

// Очистка всех пользователей (при остановке бота)
function clearAllUserFiles() {
    userFiles.forEach((files, userId) => {
        clearUserFiles(userId);
    });
}

module.exports = {
    addUserFile,
    deleteFileFromUser,
    deleteFile,
    clearUserFiles,
    clearAllUserFiles
};
