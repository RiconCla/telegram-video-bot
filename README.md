# 🤖 Telegram Video Bot

Telegram-бот для скачивания видео и изображений из TikTok и Instagram без водяных знаков. Поддерживает Reels, карусели, слайдшоу и одиночные фото. Двуязычный (RU/EN), с админ-статистикой и проверкой подписки на канал.

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)](https://nodejs.org/)
[![Telegraf](https://img.shields.io/badge/Telegraf-4.16-blue)](https://telegraf.js.org/)
[![License](https://img.shields.io/badge/license-ISC-orange)](LICENSE)

---

## 📋 Содержание

- [Функционал](#-функционал)
- [Технологии](#-технологии)
- [Структура проекта](#-структура-проекта)
- [Команды](#-команды)
- [Требования](#-требования)
- [Установка](#-установка)
- [Конфигурация](#-конфигурация)
- [Запуск](#-запуск)
- [Деплой](#-деплой)

---

## ✨ Функционал

### TikTok
- Скачивание видео (HD-качество через `tikwm.com`)
- Скачивание слайдшоу (множественные изображения)
- Приоритет вариантов: `play → wmplay → hdplay`

### Instagram
- Скачивание Reels (видео)
- Скачивание постов (одиночные фото и карусели)
- Основной путь — `yt-dlp`; embed-фоллбек, если yt-dlp не отдал файлы

### Пользовательский UX
- Двуязычный интерфейс (RU/EN), команда `/lang` для смены
- Inline-кнопки выбора языка при `/start`
- Опция «не показывать выбор языка повторно»
- Опциональная проверка подписки на обязательный канал
- Напоминания о подписке через настраиваемый интервал (5 дней по умолчанию)
- Rate limiting (1 запрос/сек на пользователя)

### Админ-функции
- Persistent menu-кнопка с командами `/stats` и `/users` (только для админа)
- Ежедневные/еженедельные/ежемесячные отчёты по статистике
- Список пользователей с разбивкой длинного списка на чанки
- Маркер `❓` для пользователей с `PARTICIPANT_ID_INVALID` + кеш, чтобы не дёргать API повторно

### Технические детали
- Сжатие видео через `ffmpeg` при превышении 50 МБ
- Нормализация кодека для совместимости с iOS/macOS
- Авто-удаление временных файлов через 10 минут
- Лимит 15 файлов на пользователя
- Дебаунс записи stats.json (1с) и invalid-users (1с)
- Параллельная проверка подписок (пул из 5) при формировании отчёта
- Кеш подписок на 12 часов
- Поддержка SOCKS5-прокси для Telegram API и yt-dlp (для серверов в РФ)

---

## 🛠 Технологии

| Категория | Стек |
|---|---|
| Runtime | Node.js 18+ |
| Bot framework | Telegraf 4.16 |
| HTTP client | axios 1.13 |
| Cron | node-cron 4 |
| Proxy | socks-proxy-agent 8 |
| Env | dotenv 16 |
| Внешние утилиты | `yt-dlp` (Instagram), `ffmpeg`/`ffprobe` (компрессия) |
| Внешний API | `tikwm.com` (TikTok) |
| Process manager | PM2 (опционально) или Docker |

---

## 📁 Структура проекта

```
telegram-video-bot/
├── bot.js                          # Точка входа, регистрация команд и middleware
├── package.json
├── credit.env                      # Переменные окружения (НЕ коммитить!)
├── deploy.sh                       # Скрипт автодеплоя через PM2
├── setup.sh                        # Установка системных зависимостей
├── Dockerfile                      # Образ для Docker/Docploy
├── .dockerignore
├── config/
│   └── config.js                   # Конфигурация приложения
├── src/
│   ├── handlers/
│   │   ├── start.js                # /start, выбор языка, кнопка активации
│   │   ├── lang.js                 # /lang, смена языка
│   │   ├── url.js                  # Обработка ссылок TikTok/Instagram
│   │   └── error.js                # bot.catch handler
│   ├── locales/
│   │   ├── en.js                   # Английская локаль
│   │   └── ru.js                   # Русская локаль
│   ├── middleware/
│   │   ├── rateLimit.js            # Rate limiting (1 req/sec)
│   │   ├── subscription.js         # Проверка подписки на канал
│   │   └── validation.js           # Валидация URL TikTok/Instagram
│   ├── services/
│   │   ├── downloader.js           # HTTP-скачивание медиа по URL (TikTok)
│   │   ├── tiktok.js               # tikwm.com API интеграция
│   │   ├── instagram.js            # Instagram через yt-dlp + embed-фоллбек
│   │   └── scheduler.js            # Cron-отчёты, /stats, /users, admin menu
│   └── utils/
│       ├── logger.js               # Логирование (console + файл с ротацией 7 дней)
│       ├── fileManager.js          # Управление временными файлами
│       ├── compressor.js           # ffmpeg-сжатие и нормализация кодека
│       ├── analytics.js            # Статистика пользователей (debounced persist)
│       ├── i18n.js                 # Локали + персист языковых настроек
│       ├── pendingSubscriptions.js # Очередь напоминаний о подписке
│       └── subscriptionCache.js    # TTL-кеш + permanent invalid-list
├── data/                           # Персистентное состояние (генерируется)
│   ├── stats.json
│   ├── users.json
│   ├── pending-subscriptions.json
│   └── invalid-subscription-users.json
├── logs/                           # Лог-файлы (ротация 7 дней)
└── temp/                           # Временные медиафайлы (TTL 10 мин)
```

---

## 💬 Команды

| Команда | Описание | Доступ |
|---|---|---|
| `/start` | Старт бота, выбор языка | все |
| `/lang` | Сменить язык | все |
| `/stats` | Статистика за текущий день | админ |
| `/stats_weekly` | Статистика за неделю | админ |
| `/stats_monthly` | Статистика за месяц | админ |
| `/users` | Полный список пользователей бота | админ |

У админа в Telegram-чате с ботом появляется persistent **Menu**-кнопка с быстрым доступом к `/stats` и `/users`.

---

## 📦 Требования

- **Node.js** ≥ 18.x
- **npm** ≥ 9.x
- **yt-dlp** (системная утилита — обязательно для Instagram)
- **ffmpeg** + **ffprobe** (для сжатия и нормализации видео)
- **PM2** (опционально — для production без Docker)
- **Docker** (опционально — для Docploy/контейнерного деплоя)

---

## 🚀 Установка

### 1. Клонировать репозиторий

```bash
git clone https://github.com/RiconCla/telegram-video-bot.git
cd telegram-video-bot
```

### 2. Установить системные зависимости

```bash
# одной командой (Debian/Ubuntu/CentOS/Fedora)
./setup.sh

# либо вручную
sudo apt-get install -y ffmpeg
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp
```

### 3. Установить npm-зависимости

```bash
npm install
```

### 4. Создать файл конфигурации

```bash
cp credit.env.example credit.env  # если есть пример, иначе создайте вручную
```

---

## ⚙️ Конфигурация

Создайте файл `credit.env` в корне проекта:

```env
# ============================================
# TELEGRAM BOT
# ============================================
BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz
REQUIRED_CHANNEL=@your_channel
CHECK_SUBSCRIPTION=true

# ============================================
# PROXY (для серверов в РФ)
# ============================================
# SOCKS5-прокси для Telegram API и yt-dlp.
# Требуется отдельно поднятый ss-local (Shadowsocks/Outline).
PROXY_HOST=127.0.0.1
PROXY_PORT=1080

# ============================================
# СТАТИСТИКА И ОТЧЁТЫ
# ============================================
ADMIN_ID=123456789                 # узнать через @userinfobot
REPORT_FREQUENCY=daily             # daily / weekly / monthly
REPORT_TIME=20:00                  # время по REPORT_TIMEZONE
REPORT_TIMEZONE=Europe/Moscow

# ============================================
# НАПОМИНАНИЯ О ПОДПИСКЕ
# ============================================
SUBSCRIPTION_REMINDER_DAYS=5       # 0 — отключить напоминания
```

> **Важно:** `dotenv` по умолчанию читает `.env`. Чтобы загрузить именно `credit.env`, запускайте бота через `node -r dotenv/config bot.js dotenv_config_path=credit.env` или переименуйте файл в `.env`.

### Получение токена бота

1. Откройте Telegram, найдите `@BotFather`
2. Создайте бота командой `/newbot`
3. Вставьте полученный токен в `BOT_TOKEN`

### Опциональные параметры прокси

`SHADOWSOCKS_*` переменные в `credit.env` сохранены как метаданные сессии и **не используются кодом напрямую** — бот ждёт уже готовый SOCKS5 на `PROXY_HOST:PROXY_PORT` (поднимается отдельным `ss-local`).

---

## 🎮 Запуск

### Локально / dev-стенд

```bash
node -r dotenv/config bot.js dotenv_config_path=credit.env
```

### Production через PM2

```bash
npm install -g pm2
pm2 start bot.js --name telegram-video-bot
pm2 save
pm2 startup
```

Управление:

```bash
pm2 status
pm2 logs telegram-video-bot
pm2 restart telegram-video-bot --update-env
pm2 stop telegram-video-bot
```

### Production через Docker

```bash
docker build -t telegram-video-bot .
docker run -d --name telegram-video-bot \
  --env-file credit.env \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/logs:/app/logs \
  telegram-video-bot
```

---

## 🖥️ Деплой

### PM2 + bash-скрипт

В репозитории лежит `deploy.sh` — pull + npm install + `pm2 reload`. Используйте его на VPS:

```bash
./deploy.sh
```

### Docker / Docploy

`Dockerfile` использует `node:18-alpine` + ставит `ffmpeg` и `yt-dlp` в образ. `.dockerignore` исключает `credit.env`, `data/`, `logs/`, `temp/`, `pics/`, `*.exe`. Для деплоя через Docploy достаточно подсунуть переменные окружения и примонтировать `data/` + `logs/` для сохранения состояния между перезапусками.

### Обновление

```bash
cd ~/telegram-video-bot
git pull origin main
npm ci --omit=dev          # подтянет зависимости
pm2 restart telegram-video-bot --update-env
# либо для Docker:
docker build -t telegram-video-bot . && docker restart telegram-video-bot
```
