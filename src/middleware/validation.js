// Домены, которые умеет обрабатывать cobalt. Ссылка считается валидной,
// если её host совпадает с доменом из списка или является его поддоменом.
const SUPPORTED_DOMAINS = [
    'tiktok.com',
    'instagram.com',
    'youtube.com', 'youtu.be',
    'twitter.com', 'x.com',
    'reddit.com', 'redd.it',
    'vk.com', 'vkvideo.ru',
    'facebook.com', 'fb.watch',
    'twitch.tv',
    'soundcloud.com',
    'tumblr.com',
    'pinterest.com', 'pin.it',
    'bilibili.com',
    'streamable.com',
    'bsky.app',
    'snapchat.com',
    'loom.com'
];

function validateUrl(url) {
    if (!url || typeof url !== 'string') {
        return { isSupported: false };
    }

    let host;
    try {
        const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
        host = new URL(normalized).hostname.toLowerCase().replace(/^www\./, '');
    } catch (e) {
        return { isSupported: false };
    }

    const isSupported = SUPPORTED_DOMAINS.some(
        (domain) => host === domain || host.endsWith(`.${domain}`)
    );

    return { isSupported };
}

module.exports = { validateUrl };
