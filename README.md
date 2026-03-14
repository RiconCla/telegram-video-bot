# 🤖 Telegram Video Bot

Telegram бот для скачивания видео и изображений из TikTok и Instagram без водяных знаков. Поддерживает карусели, Reels, слайдшоу и одиночные фото.

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)](https://nodejs.org/)
[![Telegraf](https://img.shields.io/badge/Telegraf-4.16-blue)](https://telegraf.js.org/)
[![License](https://img.shields.io/badge/license-ISC-orange)](LICENSE)

---

## 📋 Содержание

- [Функционал](#-функционал)
- [Технологии](#-технологии)
- [Структура проекта](#-структура-проекта)
- [Требования](#-требования)
- [Установка](#-установка)
- [Конфигурация](#-конфигурация)
- [Запуск](#-запуск)
- [Деплой на VPS](#-деплой-на-vps)

---

## ✨ Функционал

### TikTok
- ✅ Скачивание видео (HD качество)
- ✅ Скачивание слайдшоу (до 35 изображений)

### Instagram
- ✅ Скачивание Reels (видео)
- ✅ Скачивание постов (фото)
- ✅ Скачивание каруселей (множественные фото)
- ✅ Работает через `yt-dlp` — без прокси и внешних API

### Дополнительно
- 🔒 Проверка подписки на канал (опционально)
- ⏱️ Защита от спама (rate limiting)
- 📦 Автосжатие видео через ffmpeg (если > 50 МБ)
- 🗑️ Автоматическое удаление временных файлов через 10 минут
- 📊 Детальное логирование всех действий
- 📈 Статистика пользователей с автоматическими отчётами администратору (день/неделя/месяц)

---

## 🛠 Технологии

- **Node.js** — среда выполнения
- **Telegraf 4.16** — Telegram Bot API фреймворк
- **yt-dlp** — скачивание медиа из Instagram (системная утилита)
- **ffmpeg** — сжатие видео
- **axios** — HTTP клиент (TikTok API)
- **dotenv** — управление переменными окружения
- **PM2** — менеджер процессов
- **tikwm.com API** — TikTok downloader

---

## 📁 Структура проекта

```
telegram-video-bot/
├── bot.js                  # Точка входа
├── package.json
├── credit.env              # Переменные окружения (НЕ коммитить!)
├── deploy.sh               # Скрипт автодеплоя
├── config/
│   └── config.js           # Конфигурация приложения
├── src/
│   ├── utils/
│   │   ├── logger.js       # Логирование
│   │   ├── fileManager.js  # Управление временными файлами
│   │   ├── analytics.js    # Статистика пользователей
│   │   └── messages.js     # Текстовые сообщения бота
│   ├── middleware/
│   │   ├── rateLimit.js    # Rate limiting
│   │   ├── subscription.js # Проверка подписки на канал
│   │   └── validation.js   # Валидация URL
│   ├── services/
│   │   ├── downloader.js   # Скачивание медиа по URL (TikTok)
│   │   ├── tiktok.js       # TikTok API интеграция
│   │   ├── instagram.js    # Instagram через yt-dlp
│   │   ├── scheduler.js    # Планировщик отчётов
│   │   └── tiktokHealthcheck.js
│   └── handlers/
│       ├── start.js        # /start
│       ├── url.js          # Обработка ссылок
│       └── error.js        # Обработка ошибок
├── logs/                   # Генерируются автоматически
└── temp/                   # Временные файлы (очищаются автоматически)
```

---

## 📦 Требования

- **Node.js** >= 18.x
- **npm** >= 9.x
- **yt-dlp** (системная утилита — обязательно для Instagram)
- **ffmpeg** (для сжатия видео)
- **PM2** (для production)
- **Ubuntu/Debian** (рекомендуется)

---

## 🚀 Установка

### 1. Клонируйте репозиторий

```bash
git clone https://github.com/RiconCla/telegram-video-bot.git
cd telegram-video-bot
```

### 2. Установите системные зависимости

```bash
# ffmpeg
sudo apt-get install -y ffmpeg

# yt-dlp
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp
```

### 3. Установите npm зависимости

```bash
npm install
```

### 4. Создайте файл конфигурации

```bash
cp credit.env.example credit.env
nano credit.env
```

---

## ⚙️ Конфигурация

Создайте файл `credit.env`:

```env
# ============================================
# TELEGRAM BOT
# ============================================

# Токен бота — получить у @BotFather
BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz

# Канал для проверки подписки (@channelname или -100123456789)
REQUIRED_CHANNEL=@your_channel

# Включить проверку подписки (true/false)
CHECK_SUBSCRIPTION=false

# ============================================
# PROXY (обязательно для серверов в РФ)
# ============================================

# SOCKS5 прокси для подключения к Telegram API
# Используется ss-local (Shadowsocks/Outline) на том же сервере
PROXY_HOST=127.0.0.1
PROXY_PORT=1080

# ============================================
# СТАТИСТИКА И ОТЧЁТЫ
# ============================================

# Telegram ID администратора (узнать у @userinfobot)
ADMIN_ID=123456789

# Периодичность отчётов: daily / weekly / monthly
REPORT_FREQUENCY=daily

# Время отправки отчёта (ЧЧ:ММ)
REPORT_TIME=20:00

# Часовой пояс
REPORT_TIMEZONE=Europe/Moscow
```

### 📝 Получение токена бота

1. Откройте Telegram, найдите `@BotFather`
2. Создайте бота командой `/newbot`
3. Вставьте полученный токен в `BOT_TOKEN`

---

## 🎮 Запуск

### Локально (для разработки)

```bash
node bot.js
```

### Production (PM2)

```bash
# Установить PM2
npm install -g pm2

# Запустить
pm2 start bot.js --name telegram-video-bot

# Сохранить конфигурацию и включить автозапуск
pm2 save
pm2 startup
```

### Управление PM2

```bash
pm2 status                          # статус
pm2 logs telegram-video-bot         # логи в реальном времени
pm2 restart telegram-video-bot      # перезапуск
pm2 stop telegram-video-bot         # остановка
```

---

## 🖥️ Деплой на VPS

### 1. Подключитесь к серверу

```bash
ssh user@your-vps-ip
```

### 2. Установите окружение

```bash
# Node.js 18.x
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs git ffmpeg

# yt-dlp
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp

# PM2
sudo npm install -g pm2
```

### 3. Клонируйте и настройте

```bash
git clone https://github.com/RiconCla/telegram-video-bot.git
cd telegram-video-bot
npm install
nano credit.env
```

### 4. Запустите

```bash
pm2 start bot.js --name telegram-video-bot
pm2 save
pm2 startup
```

### 5. Обновление бота

```bash
cd ~/telegram-video-bot
git pull origin main
pm2 restart telegram-video-bot --update-env
```
