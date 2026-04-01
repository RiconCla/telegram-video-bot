module.exports = {
    LANGUAGE_SELECT:
        '👋 Welcome! I can download videos and photos from TikTok and Instagram without watermarks.\n\n' +
        '📥 Supported platforms:\n' +
        '• TikTok (videos & slideshows)\n' +
        '• Instagram (posts, reels)\n\n' +
        '🌐 Please choose your language:',

    LANGUAGE_SELECTED: '✅ Language set to English!',

    WELCOME_NEW:
        '👋 Hi! I\'ll help you download videos and photos from TikTok and Instagram without watermarks.\n\n' +
        '📥 Supported platforms:\n' +
        '• TikTok (videos or slideshows)\n' +
        '• Instagram (posts, reels)\n\n' +
        'Press the button below to get started!',

    WELCOME_BACK:
        '👋 Welcome back!\n\n' +
        '📝 Just send me a link to a video or image from TikTok or Instagram.',

    BOT_ACTIVATED: '✅ Great! Now send me a link to a video or image from TikTok or Instagram.',

    SUBSCRIPTION_REQUIRED: 'To use this bot, please subscribe to this channel! It\'s the minimum I ask of you :)',

    SUBSCRIPTION_FAILED: 'You are still not subscribed to the channel. Please subscribe and try again :)',

    SUBSCRIBE_BUTTON: '📢 Subscribe',

    CHECK_SUBSCRIPTION_BUTTON: '✅ I subscribed',

    NOT_ACTIVATED: 'Press the "🚀 Launch bot" button to get started.',

    LAUNCH_BUTTON: '🚀 Launch bot',

    INVALID_URL:
        '❌ The provided link is invalid!\n\n' +
        '⚠️ Make sure the link points to a video or image from TikTok or Instagram.\n\n',

    LOADING: '⏳ Loading, please wait...',

    SENDING_VIDEO: '📤 Sending video...',

    VIDEO_DOWNLOADED: '✅ Video downloaded',

    IMAGE_DOWNLOADED: '✅ Image downloaded',

    SEND_NEW_LINK: '💡 Send a new link to download!',

    LANG_MENU_TITLE: '🌐 Select language:',

    LANG_NO_ASK_BUTTON: '🚫 Don\'t ask',

    LANG_NO_ASK_CONFIRMED: '✅ Got it! You can always change the language with /lang.',

    LANG_CHANGED: '✅ Language changed to English!',

    CHANGE_LANGUAGE_BUTTON: '🌐 Change language',

    DOWNLOAD_ERROR:
        '❌ Failed to download media. Possible reasons:\n' +
        '• Invalid link\n' +
        '• Private account\n' +
        '• Content deleted\n' +
        '• Service temporarily unavailable\n\n' +
        '🔄 Try another link or try again later.',

    PROCESSING_ERROR: '❌ An error occurred while processing the request. Please try again.',

    UNEXPECTED_ERROR: '❌ An unexpected error occurred. Try again later or contact the administrator.',

    rateLimit: (seconds) => `⏱ Please wait ${seconds} seconds before the next request.`,

    sendingImages: (count) => `📤 Sending ${count} images...`,

    sendingImage: () => '📤 Sending image...',

    imagesDownloaded: (total, part, totalParts) => {
        if (totalParts > 1) {
            return `✅ Downloaded ${total} images (part ${part}/${totalParts})`;
        }
        return `✅ Downloaded ${total} images`;
    },

    batchPart: (part, total) => `📸 Part ${part}/${total}`,

    SUBSCRIPTION_REMINDER: 'Hi! Just a reminder — please subscribe to the channel to use the bot :)'
};
