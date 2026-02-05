function validateUrl(url) {
    const tiktokRegex = /(?:https?:\/\/)?(?:www\.|vm\.|vt\.)?tiktok\.com\/.+/i;
    const instagramRegex = /(?:https?:\/\/)?(?:www\.)?instagram\.com\/(p|reel|tv)\/[A-Za-z0-9_-]+/i;

    return {
        isTiktok: tiktokRegex.test(url),
        isInstagram: instagramRegex.test(url)
    };
}

module.exports = { validateUrl };
