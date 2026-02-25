const axios = require('axios');
const fs = require('fs');
const path = require('path');
const config = require('../../config/config');
const { log } = require('../utils/logger');
const { addUserFile } = require('../utils/fileManager');

async function downloadMediaFile(url, userId, filename, useProxy = false) {
    try {
        // Валидация URL
        if (!url || typeof url !== 'string') {
            throw new Error(`Invalid URL: ${url}`);
        }

        if (!url.startsWith('http://') && !url.startsWith('https://')) {
            throw new Error(`URL must start with http:// or https://. Got: ${url.substring(0, 50)}...`);
        }

        log('info', `Downloading media file: ${filename} from ${url.substring(0, 100)}...`, userId);

        // Уникальное имя файла
        const filePath = path.join(config.TEMP_DIR, `${userId}_${Date.now()}_${filename}`);

        // Конфигурация axios с оптимизацией
        const axiosConfig = {
            method: 'GET',
            url: url,
            responseType: 'stream',
            timeout: 60000, // 60 секунд на скачивание (было 120)
            maxRedirects: 5,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': '*/*',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Referer': 'https://www.tiktok.com/'
            },
            maxContentLength: 200 * 1024 * 1024, // Макс 50MB (Telegram limit)
            maxBodyLength: 200 * 1024 * 1024
        };

        // Используем прокси если нужно
        if (useProxy && config.SHADOWSOCKS.HOST && config.SHADOWSOCKS.PORT) {
            const { SocksProxyAgent } = require('socks-proxy-agent');
            const proxyUrl = `socks5://${config.SHADOWSOCKS.HOST}:${config.SHADOWSOCKS.PORT}`;
            const agent = new SocksProxyAgent(proxyUrl);

            axiosConfig.httpAgent = agent;
            axiosConfig.httpsAgent = agent;

            log('info', `Downloading file through Shadowsocks proxy: ${config.SHADOWSOCKS.HOST}:${config.SHADOWSOCKS.PORT}`, userId);
        } else {
            log('info', 'Downloading file directly (no proxy)', userId);
        }

        const response = await axios(axiosConfig);

        if (response.status !== 200) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        // Проверяем размер заранее
        const contentLength = parseInt(response.headers['content-length'] || '0');
        if (contentLength > 200 * 1024 * 1024) {
            throw new Error(`File too large: ${(contentLength / 1024 / 1024).toFixed(2)} MB (max 200 MB)`);
        }

        // Создаем write stream
        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);

        // Ждем завершения загрузки
        await new Promise((resolve, reject) => {
            let downloadedBytes = 0;
            let lastLogTime = Date.now();

            response.data.on('data', (chunk) => {
                downloadedBytes += chunk.length;

                // Логируем прогресс каждые 2 секунды
                const now = Date.now();
                if (now - lastLogTime > 2000) {
                    log('info', `Downloaded: ${(downloadedBytes / 1024 / 1024).toFixed(2)} MB`, userId);
                    lastLogTime = now;
                }
            });

            writer.on('finish', () => {
                log('success', `Media file downloaded: ${filename} (${(downloadedBytes / 1024 / 1024).toFixed(2)} MB)`, userId);
                resolve();
            });

            writer.on('error', (error) => {
                log('error', `File write error: ${error.message}`, userId);
                reject(error);
            });

            response.data.on('error', (error) => {
                log('error', `File download stream error: ${error.message}`, userId);
                reject(error);
            });
        });

        // Проверяем, что файл не пустой
        const stats = fs.statSync(filePath);
        if (stats.size === 0) {
            throw new Error('Downloaded file is empty');
        }

        log('info', `File saved successfully: ${filePath} (${stats.size} bytes)`, userId);

        // Добавляем файл в очередь пользователя
        addUserFile(userId, filePath);

        return filePath;

    } catch (error) {
        log('error', `Download media file error: ${error.message}`, userId);

        if (error.response) {
            log('error', `HTTP Status: ${error.response.status}`, userId);
        }

        throw error;
    }
}


module.exports = { downloadMediaFile };
