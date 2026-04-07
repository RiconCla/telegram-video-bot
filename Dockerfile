FROM node:18-alpine

# Устанавливаем ffmpeg и yt-dlp
RUN apk add --no-cache ffmpeg python3 curl
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
RUN chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD pgrep -x node > /dev/null || exit 1

CMD ["node", "bot.js"]