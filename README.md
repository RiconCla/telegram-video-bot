# Telegram Video Bot

Telegram бот для скачивания видео и изображений с TikTok и Instagram без водяных знаков.

## Функционал
- ✅ Скачивание TikTok видео/слайдшоу
- ✅ Скачивание Instagram видео/фото
- ✅ Проверка подписки на канал
- ✅ Защита от спама
- ✅ Автоочистка временных файлов

## Технологии
- Node.js
- Telegraf (Telegram Bot API)
- axios
- tikwm.com API

## Установка
```bash
npm install

### Создайте файл credit.env:
- BOT_TOKEN=ваш_токен
- REQUIRED_CHANNEL=@channelname
- CHECK_SUBSCRIPTION=false
