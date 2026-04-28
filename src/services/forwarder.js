/**
 * HTTP-клиент к autoposter `/ingest`.
 * Файлы уже скопированы в shared volume через `forwardQueue.prepareBatch`,
 * сюда передаются только пути относительно SHARED_INGEST_DIR.
 */
const axios = require('axios');
const config = require('../../config/config');

/**
 * @param {Object} entry — запись из forwardQueue.confirm()
 * @returns {Promise<{status:string, post_id?:number, duplicate?:object}>}
 */
async function postToAutoposter(entry) {
    const { userId, sourceUrl, files } = entry;
    const payload = {
        user_id: Number(userId),
        source_url: sourceUrl,
        files,
    };
    const url = `${config.AUTOPOSTER_URL.replace(/\/+$/, '')}/ingest`;
    const resp = await axios.post(url, payload, {
        headers: { Authorization: `Bearer ${config.INGEST_SECRET}` },
        timeout: 60_000,
    });
    return resp.data;
}

module.exports = { postToAutoposter };
