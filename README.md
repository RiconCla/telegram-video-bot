# 🤖 Telegram Video Bot

Telegram бот для скачивания видео и изображений из TikTok и Instagram без водяных знаков. Поддерживает карусели (множественные фото), видео и слайдшоу.

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
- ✅ Работа без прокси

### Instagram
- ✅ Скачивание Reels (видео)
- ✅ Скачивание постов (фото)
- ✅ Скачивание каруселей (множественные фото)
- ✅ Работа через Shadowsocks прокси
- ✅ Множественные методы загрузки (fallback)

### Дополнительно
- 🔒 Проверка подписки на канал (опционально)
- ⏱️ Защита от спама (rate limiting)
- 🗑️ Автоматическое удаление временных файлов через 10 минут
- 📊 Детальное логирование всех действий
- 📦 Пакетная отправка изображений (по 10 штук)

---

## 🛠 Технологии

- **Node.js** - среда выполнения
- **Telegraf 4.16** - Telegram Bot API фреймворк
- **axios** - HTTP клиент
- **dotenv** - управление переменными окружения
- **socks-proxy-agent** - поддержка SOCKS5 прокси
- **PM2** - менеджер процессов (для production)
- **tikwm.com API** - TikTok downloader
- **RapidAPI Instagram Downloader** - Instagram API

---

## 📁 Структура проекта

telegram-video-bot/
├── bot.js # Главный файл (точка входа)
├── package.json # Зависимости
├── credit.env # Переменные окружения (НЕ коммитить!)
├── deploy.sh # Скрипт автодеплоя
├── collect-code.sh # Скрипт сбора кода
├── config/
│ └── config.js # Конфигурация приложения
├── src/
│ ├── utils/
│ │ ├── logger.js # Система логирования
│ │ ├── fileManager.js # Управление временными файлами
│ │ └── messages.js # Текстовые сообщения
│ ├── middleware/
│ │ ├── rateLimit.js # Rate limiting
│ │ ├── subscription.js # Проверка подписки на канал
│ │ └── validation.js # Валидация URL
│ ├── services/
│ │ ├── downloader.js # Скачивание медиа файлов
│ │ ├── tiktok.js # TikTok API интеграция
│ │ └── instagram.js # Instagram API интеграция
│ └── handlers/
│ ├── start.js # Обработчик команды /start
│ ├── url.js # Обработчик URL ссылок
│ └── error.js # Обработчик ошибок
├── logs/ # Логи (генерируются автоматически)
└── temp/ # Временные файлы (очищаются автоматически)

---

## 📦 Требования

- **Node.js** >= 18.x
- **npm** >= 9.x
- **PM2** (для production)
- **Shadowsocks** (для Instagram, опционально)
- **Ubuntu/Debian** (для VPS деплоя)

---

## 🚀 Установка

### 1. Клонируйте репозиторий

```bash
git clone https://github.com/ваш-username/telegram-video-bot.git
cd telegram-video-bot
```

### 2. Установите зависимости

```bash
npm install
```

### 3. Создайте файл конфигурации

```bash
cp credit.env.example credit.env
nano credit.env
```

---

## ⚙️ Конфигурация

### Создайте файл credit.env со следующими параметрами:
```
# ============================================
# TELEGRAM BOT
# ============================================

# Получите токен у @BotFather в Telegram
BOT_TOKEN=123456789:ABCdefGHIjklMNOpqrsTUVwxyz

# Канал для проверки подписки (формат: @channelname или -100123456789)
REQUIRED_CHANNEL=@your_channel

# Включить проверку подписки (true/false)
CHECK_SUBSCRIPTION=false


# ============================================
# SHADOWSOCKS PROXY (для Instagram)
# ============================================
# Хост прокси (обычно 127.0.0.1 для локального Shadowsocks)
SHADOWSOCKS_HOST=127.0.0.1

# Порт прокси
SHADOWSOCKS_PORT=1080

# Пароль (если используется)
SHADOWSOCKS_PASSWORD=

# Метод шифрования
SHADOWSOCKS_METHOD=chacha20-ietf-poly1305
```

### 📝 Получение токена бота

1. Откройте Telegram и найдите @BotFather 
2. Создай бота и получите 
3. Вставьте api ключ в BOT_TOKEN в файле credit.env

### 🔐 Настройка Shadowsocks (для Instagram)
#### Instagram блокирует прямое скачивание файлов. Необходим SOCKS5 прокси.
##### Outline VPN
1. Установите Outline Manager 
2. Создайте сервер 
3. Получите Access Key (формат: ss://метод:пароль@хост:порт)
4. Установите shadowsocks-libev на VPS:
```bash
sudo apt-get update
sudo apt-get install shadowsocks-libev
```
5. Создайте конфигурацию:
```bash
sudo nano /etc/shadowsocks-libev/config.json
```
Содержимое:
```json
{
  "server": "ваш-сервер-ip",
  "server_port": 30964,
  "local_address": "127.0.0.1",
  "local_port": 1080,
  "password": "ваш-пароль",
  "timeout": 300,
  "method": "chacha20-ietf-poly1305"
}
```
6. Запустите:
```bash
sudo systemctl start shadowsocks-libev-local@config
sudo systemctl enable shadowsocks-libev-local@config
```
7. Проверьте:
```bash
systemctl status shadowsocks-libev-local@config
curl --socks5 127.0.0.1:1080 https://api.ipify.org
```

#### 🔑 RapidAPI ключ 
API ключ для Instagram вставьте config/config.js. Получить можно:

1. Зарегистрируйтесь на RapidAPI 
2. Подпишитесь на Instagram Downloader (какой нравится)
3. Указать RAPIDAPI_KEY в config/config.js

#### 🎮 Запуск
Запуск (с PM2)
```bash
# Установите PM2 глобально
npm install -g pm2

# Запустите бота
pm2 start bot.js --name telegram-video-bot

# Сохраните конфигурацию PM2
pm2 save

# Настройте автозапуск при перезагрузке сервера
pm2 startup
```

Управление PM2

```bash
# Посмотреть статус
pm2 status

# Остановить бота
pm2 stop telegram-video-bot

# Перезапустить бота
pm2 restart telegram-video-bot

# Посмотреть логи в реальном времени
pm2 logs telegram-video-bot

# Удалить из PM2
pm2 delete telegram-video-bot
```

#### 🖥️ Деплой на VPS
1. Подключитесь к серверу
```bash
ssh user@your-vps-ip
```

2. Установите необходимое ПО
```bash
# Обновите систему
sudo apt-get update && sudo apt-get upgrade -y

# Установите Node.js 18.x
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Установите Git
sudo apt-get install -y git

# Установите PM2
sudo npm install -g pm2

# Установите Shadowsocks (если нужен)
sudo apt-get install -y shadowsocks-libev
```
3. Клонируйте проект
```bash
cd ~
git clone https://github.com/ваш-username/telegram-video-bot.git
cd telegram-video-bot
```
4. Настройте бота
```bash
# Создайте конфигурацию
nano credit.env
# Вставьте ваши настройки
```
5. Запустите бота
```bash
pm2 start bot.js --name telegram-video-bot
pm2 save
pm2 startup
```