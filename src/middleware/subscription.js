const config = require('../../config/config');
const { log } = require('../utils/logger');
const subscriptionCache = require('../utils/subscriptionCache');

async function checkSubscription(ctx) {
    if (!config.CHECK_SUBSCRIPTION) {
        log('info', 'Subscription check is disabled', ctx.from.id);
        return true;
    }

    try {
        const member = await ctx.telegram.getChatMember(
            config.REQUIRED_CHANNEL,
            ctx.from.id
        );

        const isSubscribed = ['creator', 'administrator', 'member'].includes(member.status);
        subscriptionCache.set(ctx.from.id, isSubscribed);
        log('info', `Subscription check: ${isSubscribed ? 'PASSED' : 'FAILED'}`, ctx.from.id);
        return isSubscribed;
    } catch (error) {
        log('error', `Subscription check error: ${error.message}`, ctx.from.id);
        return false;
    }
}

module.exports = { checkSubscription };
