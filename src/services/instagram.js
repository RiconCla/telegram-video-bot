const { execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { SocksProxyAgent } = require('socks-proxy-agent');
const config = require('../../config/config');
const { log } = require('../utils/logger');

const execFileAsync = promisify(execFile);

const VIDEO_EXTS = /\.(mp4|mkv|webm|mov|avi|m4v)$/i;

// Используем локальный yt-dlp если есть, иначе глобальный
const localYtDlp = path.join(__dirname, '..', '..', 'yt-dlp.exe');
const YT_DLP = fs.existsSync(localYtDlp) ? localYtDlp : 'yt-dlp';

// Ошибки yt-dlp, для которых имеет смысл пробовать embed-фоллбек
const FALLBACK_ERROR_PATTERNS = [
    /there is no video in this post/i,
    /no video could be found/i,
    /empty media response/i,
    /unable to extract shared data/i,
    /requested format is not available/i
];

async function runYtDlp(args, timeout = 120000) {
    return execFileAsync(YT_DLP, args, { timeout });
}

function extractShortcode(url) {
    const m = url.match(/instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/i);
    return m ? m[1] : null;
}

function buildProxyAgent() {
    if (config.PROXY_HOST && config.PROXY_PORT) {
        return new SocksProxyAgent(`socks5://${config.PROXY_HOST}:${config.PROXY_PORT}`);
    }
    return null;
}

async function downloadInstagram(url, userId) {
    log('info', `Starting Instagram download via yt-dlp: ${url}`, userId);

    const userDir = path.join(config.TEMP_DIR, String(userId));

    if (!fs.existsSync(userDir)) {
        fs.mkdirSync(userDir, { recursive: true });
    }

    const beforeTime = Date.now();
    const outputTemplate = path.join(userDir, '%(id)s.%(ext)s');

    const ytDlpArgs = ['--output', outputTemplate, '--no-warnings', '--force-overwrites'];
    if (config.PROXY_HOST && config.PROXY_PORT) {
        ytDlpArgs.push('--proxy', `socks5://${config.PROXY_HOST}:${config.PROXY_PORT}`);
        log('info', `yt-dlp will use proxy: ${config.PROXY_HOST}:${config.PROXY_PORT}`, userId);
    }

    let downloadOk = false;
    let ytDlpStderr = '';
    try {
        log('info', 'Running yt-dlp (attempt 1)', userId);
        const { stdout, stderr } = await runYtDlp([...ytDlpArgs, url]);
        if (stdout) log('info', `yt-dlp stdout: ${stdout.trim()}`, userId);
        if (stderr) log('warning', `yt-dlp stderr: ${stderr.trim()}`, userId);
        downloadOk = true;
    } catch (err1) {
        ytDlpStderr = err1.stderr || '';
        const stdout = err1.stdout || '';
        log('warning', `yt-dlp attempt 1 failed: ${err1.message}`, userId);
        if (ytDlpStderr) log('warning', `yt-dlp stderr: ${ytDlpStderr.trim()}`, userId);
        if (stdout) log('info', `yt-dlp stdout: ${stdout.trim()}`, userId);
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
        const shouldTryFallback = FALLBACK_ERROR_PATTERNS.some(p => p.test(ytDlpStderr));
        if (shouldTryFallback || ytDlpStderr === '') {
            log('info', 'Trying Instagram embed fallback (image/photo post)', userId);
            const fallbackFiles = await downloadInstagramViaEmbed(url, userId, userDir);
            if (fallbackFiles && fallbackFiles.length > 0) {
                return buildResult(fallbackFiles, userId);
            }
        }

        log('error', 'yt-dlp download failed', userId);
        return { success: false };
    }

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

    return buildResult(newFiles, userId);
}

function buildResult(files, userId) {
    if (files.length === 1) {
        const filePath = files[0];
        const type = VIDEO_EXTS.test(filePath) ? 'video' : 'image';
        log('success', `Instagram download successful: single ${type} → ${filePath}`, userId);
        return { success: true, type, url: filePath };
    }

    const hasVideo = files.some(f => VIDEO_EXTS.test(f));
    log('success', `Instagram download successful: carousel with ${files.length} items`, userId);
    return {
        success: true,
        type: hasVideo ? 'mixed' : 'image',
        url: files
    };
}

// ---------- Embed-фоллбек для фото-постов ----------

async function downloadInstagramViaEmbed(url, userId, userDir) {
    const shortcode = extractShortcode(url);
    if (!shortcode) {
        log('error', 'Instagram embed fallback: cannot extract shortcode', userId);
        return null;
    }

    let mediaItems;
    try {
        mediaItems = await fetchEmbedMedia(shortcode, userId);
    } catch (e) {
        log('error', `Instagram embed fallback: embed page fetch failed: ${e.message}`, userId);
        return null;
    }

    if (!mediaItems || mediaItems.length === 0) {
        log('error', 'Instagram embed fallback: no media URLs found on embed page', userId);
        return null;
    }

    log('info', `Instagram embed fallback: found ${mediaItems.length} media URL(s)`, userId);

    const savedPaths = [];
    for (let i = 0; i < mediaItems.length; i++) {
        const { type, url: mediaUrl } = mediaItems[i];
        const ext = type === 'video' ? 'mp4' : 'jpg';
        const destPath = path.join(userDir, `${shortcode}_${i}.${ext}`);
        try {
            await downloadUrlToFile(mediaUrl, destPath, userId);
            savedPaths.push(destPath);
        } catch (e) {
            log('warning', `Instagram embed fallback: item ${i} download failed: ${e.message}`, userId);
        }
    }

    return savedPaths.length > 0 ? savedPaths : null;
}

async function fetchEmbedMedia(shortcode, userId) {
    const embedUrl = `https://www.instagram.com/p/${shortcode}/embed/captioned/`;
    log('info', `Instagram embed fallback: GET ${embedUrl}`, userId);

    const agent = buildProxyAgent();
    const axiosOpts = {
        timeout: 30000,
        maxRedirects: 5,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
            'Accept-Language': 'en-US,en;q=0.9',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        }
    };
    if (agent) {
        axiosOpts.httpsAgent = agent;
        axiosOpts.httpAgent = agent;
    }

    const { data: html } = await axios.get(embedUrl, axiosOpts);
    return extractMediaFromEmbedHtml(html);
}

function extractMediaFromEmbedHtml(html) {
    // 1. JSON из window.__additionalDataLoaded(...) — содержит полную карусель + видео
    const addlRe = /window\.__additionalDataLoaded\s*\(\s*['"][^'"]+['"]\s*,\s*({[\s\S]*?})\s*\)\s*;/g;
    let m;
    while ((m = addlRe.exec(html)) !== null) {
        const media = tryParseShortcodeMedia(m[1]);
        if (media) {
            const items = mediaNodeToItems(media);
            if (items && items.length) return items;
        }
    }

    // 2. window._sharedData = {...};
    const sharedRe = /window\._sharedData\s*=\s*({[\s\S]*?})\s*;<\/script>/;
    const sharedMatch = html.match(sharedRe);
    if (sharedMatch) {
        try {
            const shared = JSON.parse(sharedMatch[1]);
            const media = shared?.entry_data?.PostPage?.[0]?.graphql?.shortcode_media
                || shared?.entry_data?.PostPage?.[0]?.media;
            if (media) {
                const items = mediaNodeToItems(media);
                if (items && items.length) return items;
            }
        } catch (e) { /* fallthrough */ }
    }

    // 3. <img class="EmbeddedMediaImage ..." src="..."> — для одиночного фото
    const imgMatch = html.match(/class="[^"]*EmbeddedMediaImage[^"]*"[^>]*src="([^"]+)"/);
    if (imgMatch) {
        return [{ type: 'image', url: decodeHtmlEntities(imgMatch[1]) }];
    }

    // 4. og:image — крайний фоллбек, даст хотя бы превью
    const ogMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/);
    if (ogMatch) {
        return [{ type: 'image', url: decodeHtmlEntities(ogMatch[1]) }];
    }

    return null;
}

function tryParseShortcodeMedia(raw) {
    try {
        const data = JSON.parse(raw);
        return data.shortcode_media || data?.graphql?.shortcode_media || null;
    } catch (e) {
        return null;
    }
}

function mediaNodeToItems(media) {
    if (media.edge_sidecar_to_children?.edges?.length) {
        return media.edge_sidecar_to_children.edges.map(e => {
            const node = e.node;
            if (node.is_video && node.video_url) {
                return { type: 'video', url: node.video_url };
            }
            return { type: 'image', url: node.display_url };
        }).filter(x => !!x.url);
    }
    if (media.is_video && media.video_url) {
        return [{ type: 'video', url: media.video_url }];
    }
    if (media.display_url) {
        return [{ type: 'image', url: media.display_url }];
    }
    return null;
}

function decodeHtmlEntities(str) {
    return str
        .replace(/\\u0026/g, '&')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#x2F;/g, '/')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');
}

async function downloadUrlToFile(url, destPath, userId) {
    const agent = buildProxyAgent();
    const axiosOpts = {
        method: 'GET',
        url,
        responseType: 'stream',
        timeout: 60000,
        maxRedirects: 5,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
            'Referer': 'https://www.instagram.com/'
        },
        maxContentLength: 200 * 1024 * 1024,
        maxBodyLength: 200 * 1024 * 1024
    };
    if (agent) {
        axiosOpts.httpsAgent = agent;
        axiosOpts.httpAgent = agent;
    }

    const response = await axios(axiosOpts);

    await new Promise((resolve, reject) => {
        const writer = fs.createWriteStream(destPath);
        response.data.pipe(writer);
        writer.on('finish', resolve);
        writer.on('error', reject);
        response.data.on('error', reject);
    });

    const stats = fs.statSync(destPath);
    if (stats.size === 0) {
        fs.unlinkSync(destPath);
        throw new Error('Downloaded file is empty');
    }
    log('info', `Instagram embed fallback: saved ${path.basename(destPath)} (${(stats.size / 1024).toFixed(1)} KB)`, userId);
}

module.exports = { downloadInstagram };
