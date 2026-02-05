const { log } = require('../utils/logger');
const messages = require('../utils/messages');

function handleBotError(err, ctx) {
    const userId = ctx.from?.id;
    log('error', `Bot error: ${err.message}`, userId);
    console.error('Full error:', err);

    try {
        ctx.reply(messages.UNEXPECTED_ERROR);
    } catch (e) {
        log('error', 'Failed to send error message to user', userId);
    }
}

module.exports = { handleBotError };
