const axios = require('axios');
const config = require('../../config/config');
const { log } = require('../utils/logger');

async function downloadInstagram(url, userId) {
    log('info', `Starting Instagram download: ${url}`, userId);

    // Метод 1: RapidAPI Instagram Downloader с Shadowsocks
    try {
        log('info', 'Trying Method 1: RapidAPI with Shadowsocks', userId);

        const { SocksProxyAgent } = require('socks-proxy-agent');

        let axiosConfig = {
            params: { url: url },
            headers: {
                'x-rapidapi-host': config.RAPIDAPI_HOST,
                'x-rapidapi-key': config.RAPIDAPI_KEY
            },
            timeout: 20000
        };

        if (config.SHADOWSOCKS.HOST && config.SHADOWSOCKS.PORT) {
            const proxyUrl = `socks5://${config.SHADOWSOCKS.HOST}:${config.SHADOWSOCKS.PORT}`;
            const agent = new SocksProxyAgent(proxyUrl);

            axiosConfig.httpAgent = agent;
            axiosConfig.httpsAgent = agent;

            log('info', `Using Shadowsocks proxy: ${config.SHADOWSOCKS.HOST}:${config.SHADOWSOCKS.PORT}`, userId);
        }

        const response = await axios.get(
            `https://${config.RAPIDAPI_HOST}/convert`,
            axiosConfig
        );

        if (response.data) {
            const data = response.data;

            if (data.media && Array.isArray(data.media) && data.media.length > 0) {
                // Одно медиа
                if (data.media.length === 1) {
                    const mediaItem = data.media[0];
                    const mediaType = mediaItem.type || 'video';
                    log('success', `Method 1 successful: single ${mediaType}`, userId);
                    return {
                        success: true,
                        type: mediaType,
                        url: mediaItem.url
                    };
                }

                // Карусель - собираем все URL
                const mediaUrls = [];
                const mediaTypes = new Set();

                for (const mediaItem of data.media) {
                    if (mediaItem.url) {
                        mediaUrls.push(mediaItem.url);
                        mediaTypes.add(mediaItem.type || 'image');
                    }
                }

                if (mediaUrls.length > 0) {
                    const hasVideo = mediaTypes.has('video');
                    const finalType = mediaUrls.length === 1
                        ? (mediaTypes.has('video') ? 'video' : 'image')
                        : (hasVideo ? 'mixed' : 'image');

                    log('success', `Method 1 successful: carousel with ${mediaUrls.length} items (${Array.from(mediaTypes).join(', ')})`, userId);

                    return {
                        success: true,
                        type: finalType,
                        url: mediaUrls
                    };
                }
            }

            log('warning', `Method 1 unexpected response format`, userId);
        }
    } catch (error) {
        log('warning', `Method 1 (Shadowsocks) failed: ${error.message}`, userId);
        if (error.response) {
            log('warning', `Method 1 status: ${error.response.status}`, userId);
        }
    }

    // Метод 2: Прямой запрос к Instagram
    try {
        log('info', 'Trying Method 2: Instagram direct with carousel support', userId);

        const shortcode = url.match(/\/(p|reel|tv)\/([^/?]+)/)?.[2];
        if (shortcode) {
            const response = await axios.get(`https://www.instagram.com/p/${shortcode}/`, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1',
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                },
                timeout: 15000
            });

            const html = response.data;

            // Ищем все display_url
            const displayUrls = [];
            const displayUrlRegex = /"display_url":"([^"]+)"/g;
            let match;

            while ((match = displayUrlRegex.exec(html)) !== null) {
                const imageUrl = match[1].replace(/\\/g, '');
                if (!displayUrls.includes(imageUrl)) {
                    displayUrls.push(imageUrl);
                }
            }

            // Ищем video_url
            const videoMatch = html.match(/"video_url":"([^"]+)"/);

            if (videoMatch) {
                const videoUrl = videoMatch[1].replace(/\\u0026/g, '&').replace(/\\/g, '');
                log('success', 'Method 2 successful: video', userId);
                return { success: true, type: 'video', url: videoUrl };
            }

            if (displayUrls.length > 1) {
                log('success', `Method 2 successful: carousel with ${displayUrls.length} images`, userId);
                return {
                    success: true,
                    type: 'image',
                    url: displayUrls
                };
            }

            if (displayUrls.length === 1) {
                log('success', 'Method 2 successful: single image', userId);
                return { success: true, type: 'image', url: displayUrls[0] };
            }
        }
    } catch (error) {
        log('warning', `Method 2 failed: ${error.message}`, userId);
    }

    // Метод 3: Старый embed метод
    try {
        log('info', 'Trying Method 3: Legacy embed with carousel support', userId);

        const embedUrl = url.includes('?') ? url.split('?')[0] : url;
        const finalUrl = embedUrl.endsWith('/') ? embedUrl + 'embed/captioned' : embedUrl + '/embed/captioned';

        const htmlResponse = await axios.get(finalUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            timeout: 15000
        });

        const html = htmlResponse.data;

        // Ищем видео
        if (html.includes('video_url')) {
            const match = html.match(/"video_url":"([^"]+)"/);
            if (match) {
                const mediaUrl = match[1].replace(/\\u0026/g, '&').replace(/\\/g, '');
                log('success', 'Method 3 successful: video', userId);
                return { success: true, type: 'video', url: mediaUrl };
            }
        }

        // Ищем ВСЕ display_url
        const displayUrls = [];
        const displayUrlRegex = /"display_url":"([^"]+)"/g;
        let match;

        while ((match = displayUrlRegex.exec(html)) !== null) {
            const imageUrl = match[1].replace(/\\/g, '');
            if (!displayUrls.includes(imageUrl)) {
                displayUrls.push(imageUrl);
            }
        }

        if (displayUrls.length > 1) {
            log('success', `Method 3 successful: carousel with ${displayUrls.length} images`, userId);
            return {
                success: true,
                type: 'image',
                url: displayUrls
            };
        }

        if (displayUrls.length === 1) {
            log('success', 'Method 3 successful: single image', userId);
            return { success: true, type: 'image', url: displayUrls[0] };
        }

    } catch (error) {
        log('warning', `Method 3 failed: ${error.message}`, userId);
    }

    log('error', 'All Instagram download methods failed', userId);
    return { success: false };
}

module.exports = { downloadInstagram };
