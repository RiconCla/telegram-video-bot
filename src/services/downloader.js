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

        // Конфигурация axios
        const axiosConfig = {
            method: 'GET',
            url: url,
            responseType: 'stream',
            timeout: 120000,
            maxRedirects: 5,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': '*/*',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Referer': 'https://www.tiktok.com/'
            }
        };

        // Используем прокси ТОЛЬКО для Instagram
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

        // Создаем write stream
        const writer = fs.createWriteStream(filePath);
        response.data.pipe(writer);

        // Ждем завершения загрузки
        await new Promise((resolve, reject) => {
            let downloadedBytes = 0;

            response.data.on('data', (chunk) => {
                downloadedBytes += chunk.length;
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
            log('error', `HTTP Headers: ${JSON.stringify(error.response.headers)}`, userId);
        }

        throw error;
    }
}

module.exports = { downloadMediaFile };
