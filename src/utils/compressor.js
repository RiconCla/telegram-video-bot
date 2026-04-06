const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const { log } = require('./logger');

const execFileAsync = promisify(execFile);
const MAX_SIZE = 49 * 1024 * 1024; // 49 MB с запасом

// Apple-совместимые параметры кодирования
const APPLE_COMPAT_ARGS = [
    '-profile:v', 'baseline',
    '-level', '3.1',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart'
];

/**
 * Проверяет кодек видео через ffprobe и перекодирует в H.264 если нужно.
 * Решает проблему: VP9/HEVC видео не воспроизводятся на iOS/macOS в Telegram.
 */
async function ensureCompatible(inputPath, userId) {
    try {
        const { stdout } = await execFileAsync('ffprobe', [
            '-v', 'quiet',
            '-print_format', 'json',
            '-show_streams',
            '-select_streams', 'v:0',
            inputPath
        ]);

        const info = JSON.parse(stdout);
        const video = info.streams && info.streams[0];

        if (!video) {
            log('warning', 'ffprobe: no video stream found, skipping compatibility check', userId);
            return inputPath;
        }

        const codec = video.codec_name;
        const pixFmt = video.pix_fmt;
        const isH264 = codec === 'h264';
        const isYuv420p = pixFmt === 'yuv420p';
        const isMp4 = path.extname(inputPath).toLowerCase() === '.mp4';

        if (isH264 && isYuv420p && isMp4) {
            log('info', `Video already compatible (h264/yuv420p/mp4), skipping re-encode`, userId);
            return inputPath;
        }

        log('info', `Video codec: ${codec}/${pixFmt} → re-encoding to H.264 for Apple compatibility`, userId);

        const ext = path.extname(inputPath);
        const outputPath = inputPath.replace(ext, '_compat.mp4');

        await new Promise((resolve, reject) => {
            execFile('ffmpeg', [
                '-i', inputPath,
                '-vcodec', 'libx264',
                '-crf', '23',
                '-preset', 'fast',
                '-acodec', 'aac',
                ...APPLE_COMPAT_ARGS,
                '-y',
                outputPath
            ], (error) => {
                if (error) {
                    log('error', `FFmpeg re-encode failed: ${error.message}`, userId);
                    return reject(new Error(`FFmpeg error: ${error.message}`));
                }
                resolve();
            });
        });

        // Удаляем оригинал, возвращаем совместимый файл
        if (fs.existsSync(inputPath)) {
            fs.unlinkSync(inputPath);
        }
        log('success', `Re-encoded to Apple-compatible H.264: ${outputPath}`, userId);
        return outputPath;

    } catch (err) {
        log('warning', `ensureCompatible failed (${err.message}), sending original file`, userId);
        return inputPath;
    }
}

async function compressVideo(inputPath, userId) {
    const stats = fs.statSync(inputPath);
    if (stats.size <= MAX_SIZE) {
        return inputPath; // Файл влезает — сжатие не нужно
    }

    const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
    log('info', `Video too large (${sizeMB} MB), compressing with ffmpeg...`, userId);

    const outputPath = inputPath.replace(/\.mp4$/, '_compressed.mp4');

    return new Promise((resolve, reject) => {
        execFile('ffmpeg', [
            '-i', inputPath,
            '-vcodec', 'libx264',
            '-crf', '30',
            '-preset', 'fast',
            '-acodec', 'aac',
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

module.exports = { compressVideo, ensureCompatible };
