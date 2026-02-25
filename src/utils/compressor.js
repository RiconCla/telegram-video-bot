const { execFile } = require('child_process');
const fs = require('fs');
const { log } = require('./logger');

const MAX_SIZE = 49 * 1024 * 1024; // 49 MB с запасом

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

module.exports = { compressVideo };
