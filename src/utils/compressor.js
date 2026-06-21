const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const { log } = require('./logger');

const execFileAsync = promisify(execFile);
const MAX_SIZE = 49 * 1024 * 1024; // 49 MB — порог, выше которого сжимаем
const TARGET_BYTES = 45 * 1024 * 1024; // целевой размер сжатого видео (запас под лимит Telegram 50MB)

// Используем локальные бинарники если есть, иначе глобальные
const projectRoot = path.join(__dirname, '..', '..');
const localFfmpeg = path.join(projectRoot, 'ffmpeg.exe');
const localFfprobe = path.join(projectRoot, 'ffprobe.exe');
const FFMPEG = fs.existsSync(localFfmpeg) ? localFfmpeg : 'ffmpeg';
const FFPROBE = fs.existsSync(localFfprobe) ? localFfprobe : 'ffprobe';

// Apple-совместимые параметры кодирования (main profile поддерживает до 1080p)
const APPLE_COMPAT_ARGS = [
    '-profile:v', 'main',
    '-level', '4.0',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart'
];

/**
 * Получает метаданные видео (width, height, duration) через ffprobe.
 * Учитывает rotation metadata для корректного определения размеров.
 */
async function getVideoMeta(filePath) {
    const { stdout } = await execFileAsync(FFPROBE, [
        '-v', 'quiet',
        '-print_format', 'json',
        '-show_streams', '-show_format',
        '-select_streams', 'v:0',
        filePath
    ]);
    const info = JSON.parse(stdout);
    const video = info.streams && info.streams[0];
    if (!video) return null;

    let width = parseInt(video.width);
    let height = parseInt(video.height);

    // Проверяем rotation — если 90° или 270°, меняем width/height местами
    const rotation = parseInt(video.rotation || '0');
    if (rotation === 90 || rotation === -90 || rotation === 270 || rotation === -270) {
        [width, height] = [height, width];
    }

    // Также проверяем side_data (display matrix) для rotation
    if (video.side_data_list) {
        const displayMatrix = video.side_data_list.find(sd => sd.side_data_type === 'Display Matrix');
        if (displayMatrix && displayMatrix.rotation) {
            const matrixRotation = Math.abs(parseInt(displayMatrix.rotation));
            if (matrixRotation === 90 || matrixRotation === 270) {
                // Swap only if not already swapped by video.rotation
                if (!rotation || rotation === 0) {
                    [width, height] = [height, width];
                }
            }
        }
    }

    return {
        width,
        height,
        duration: Math.round(parseFloat((info.format && info.format.duration) || video.duration || 0))
    };
}

async function compressVideo(inputPath, userId) {
    const stats = fs.statSync(inputPath);
    if (stats.size <= MAX_SIZE) {
        return inputPath; // Файл влезает — сжатие не нужно
    }

    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
    log('info', `Video too large (${sizeMB} MB), compressing with ffmpeg...`, userId);

    // Убираем любое расширение (.webm/.mkv/.mp4) и добавляем _compressed.mp4 —
    // выход всегда отличается от входа (ffmpeg не умеет писать поверх входного файла).
    const outputPath = inputPath.replace(/\.[^.\\/]+$/, '') + '_compressed.mp4';

    // Считаем целевой видео-битрейт от длительности, чтобы ГАРАНТИРОВАННО влезть
    // под лимит Telegram-бота (50MB). Целимся в TARGET_BYTES с запасом.
    let duration = 0;
    try {
        const meta = await getVideoMeta(inputPath);
        if (meta && meta.duration) duration = meta.duration;
    } catch (e) { /* ниже фоллбек на CRF */ }

    const audioKbps = 128;
    let rateArgs;
    if (duration > 0) {
        const targetTotalKbps = (TARGET_BYTES * 8) / 1000 / duration; // kbit/s
        let videoKbps = Math.floor(targetTotalKbps - audioKbps);
        if (videoKbps < 90) videoKbps = 90; // нижний предел качества (очень длинные видео)
        rateArgs = [
            '-b:v', `${videoKbps}k`,
            '-maxrate', `${Math.floor(videoKbps * 1.45)}k`,
            '-bufsize', `${videoKbps * 2}k`,
        ];
        log('info', `Target video bitrate: ${videoKbps}k (duration ${duration}s)`, userId);
    } else {
        rateArgs = ['-crf', '30']; // длительность неизвестна — фоллбек
    }

    return new Promise((resolve, reject) => {
        execFile(FFMPEG, [
            '-i', inputPath,
            // даунскейл до 1080 по высоте только при сжатии (4K/ультраширокие → меньше битрейта)
            '-vf', "scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
            '-vcodec', 'libx264',
            ...rateArgs,
            '-preset', 'fast',
            '-acodec', 'aac',
            '-b:a', `${audioKbps}k`,
            ...APPLE_COMPAT_ARGS,
            '-y',
            outputPath
        ], (error) => {
            if (error) {
                log('error', `FFmpeg compression failed: ${error.message}`, userId);
                return reject(new Error(`FFmpeg error: ${error.message}`));
            }
            const newSize = (fs.statSync(outputPath).size / 1024 / 1024).toFixed(2);
            log('info', `Compressed: ${sizeMB} MB → ${newSize} MB`, userId);
            resolve(outputPath);
        });
    });
}

module.exports = { compressVideo, getVideoMeta };
