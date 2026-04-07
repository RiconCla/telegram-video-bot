const { execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs');
const config = require('../../config/config');
const { log } = require('../utils/logger');

const execFileAsync = promisify(execFile);

const VIDEO_EXTS = /\.(mp4|mkv|webm|mov|avi|m4v)$/i;

// Используем локальный yt-dlp если есть, иначе глобальный
const localYtDlp = path.join(__dirname, '..', '..', 'yt-dlp.exe');
const YT_DLP = fs.existsSync(localYtDlp) ? localYtDlp : 'yt-dlp';

async function runYtDlp(args, timeout = 120000) {
    return execFileAsync(YT_DLP, args, { timeout });
}

async function downloadInstagram(url, userId) {
    log('info', `Starting Instagram download via yt-dlp: ${url}`, userId);

    const userDir = path.join(config.TEMP_DIR, String(userId));

    if (!fs.existsSync(userDir)) {
        fs.mkdirSync(userDir, { recursive: true });
    }

    // Запоминаем время перед загрузкой для детекции новых/перезаписанных файлов
    const beforeTime = Date.now();
    const outputTemplate = path.join(userDir, '%(id)s.%(ext)s');

    // Формируем аргументы yt-dlp (с прокси если настроен)
    const ytDlpArgs = ['--output', outputTemplate, '--no-warnings', '--force-overwrites'];
    if (config.PROXY_HOST && config.PROXY_PORT) {
        ytDlpArgs.push('--proxy', `socks5://${config.PROXY_HOST}:${config.PROXY_PORT}`);
        log('info', `yt-dlp will use proxy: ${config.PROXY_HOST}:${config.PROXY_PORT}`, userId);
    }

    // Try download (yt-dlp handles video, photo, and carousel automatically)
    let downloadOk = false;
    try {
        log('info', 'Running yt-dlp (attempt 1)', userId);
        const { stdout, stderr } = await runYtDlp([...ytDlpArgs, url]);
        if (stdout) log('info', `yt-dlp stdout: ${stdout.trim()}`, userId);
        if (stderr) log('warning', `yt-dlp stderr: ${stderr.trim()}`, userId);
        downloadOk = true;
    } catch (err1) {
        const stderr = err1.stderr || '';
        const stdout = err1.stdout || '';
        log('warning', `yt-dlp attempt 1 failed: ${err1.message}`, userId);
        if (stderr) log('warning', `yt-dlp stderr: ${stderr.trim()}`, userId);
        if (stdout) log('info', `yt-dlp stdout: ${stdout.trim()}`, userId);
        // Some yt-dlp versions exit non-zero on warnings even on success — check files anyway
        const hasNew = fs.readdirSync(userDir).some(f => {
            const stat = fs.statSync(path.join(userDir, f));
            return stat.isFile() && stat.mtimeMs >= beforeTime;
        });
        if (hasNew) {
            log('info', 'Files found despite non-zero exit, treating as success', userId);
            downloadOk = true;
        }
    }

    if (!downloadOk) {
        log('error', 'yt-dlp download failed', userId);
        return { success: false };
    }

    // Collect newly downloaded/overwritten files
    const newFiles = fs.readdirSync(userDir)
        .map(f => path.join(userDir, f))
        .filter(f => {
            const stat = fs.statSync(f);
            return stat.isFile() && stat.mtimeMs >= beforeTime;
        });

    if (newFiles.length === 0) {
        log('error', 'yt-dlp ran but no new files found in user dir', userId);
        return { success: false };
    }

    if (newFiles.length === 1) {
        const filePath = newFiles[0];
        const type = VIDEO_EXTS.test(filePath) ? 'video' : 'image';
        log('success', `yt-dlp successful: single ${type} → ${filePath}`, userId);
        return { success: true, type, url: filePath };
    }

    // Multiple files = carousel
    const hasVideo = newFiles.some(f => VIDEO_EXTS.test(f));
    log('success', `yt-dlp successful: carousel with ${newFiles.length} items`, userId);
    return {
        success: true,
        type: hasVideo ? 'mixed' : 'image',
        url: newFiles
    };
}

module.exports = { downloadInstagram };
