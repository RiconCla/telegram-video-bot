FROM node:18-alpine

# ffmpeg нужен для compressVideo/getVideoMeta (метаданные + сжатие видео >49MB).
# yt-dlp/python больше не нужны — вся загрузка идёт через cobalt.
RUN apk add --no-cache ffmpeg

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD pgrep -x node > /dev/null || exit 1

CMD ["node", "bot.js"]