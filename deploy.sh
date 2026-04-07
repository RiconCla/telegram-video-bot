#!/bin/bash

# ============================================
# Telegram Bot Auto-Deploy Script
# ============================================

set -e  # Остановить скрипт при любой ошибке

# Загрузка nvm и Node.js окружения
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# Если nvm нет — пробуем стандартные пути npm global
export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:/usr/local/bin:$PATH"

# Цвета для вывода
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Конфигурация
PROJECT_DIR=/home/claw/projects/telegram-video-bot
BOT_NAME="telegram-video-bot"
BRANCH="main"  # Или "master", в зависимости от вашего репозитория

echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Telegram Bot Auto-Deploy Script     ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

# Функция логирования
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_step() {
    echo -e "${BLUE}==>${NC} $1"
}

# Переходим в директорию проекта
log_step "Переход в директорию проекта..."
cd $PROJECT_DIR || {
    log_error "Директория проекта не найдена: $PROJECT_DIR"
    exit 1
}
log_info "Текущая директория: $(pwd)"
echo ""

# Проверяем текущую версию (коммит)
log_step "Проверка текущей версии..."
CURRENT_COMMIT=$(git rev-parse --short HEAD)
log_info "Текущий коммит: $CURRENT_COMMIT"
echo ""

# Получаем обновления из Git
log_step "Получение обновлений из GitHub..."
git fetch origin $BRANCH

# Проверяем, есть ли новые изменения
LATEST_COMMIT=$(git rev-parse --short origin/$BRANCH)
log_info "Последний коммит на GitHub: $LATEST_COMMIT"

if [ "$CURRENT_COMMIT" == "$LATEST_COMMIT" ]; then
    log_warning "Нет новых изменений. Деплой не требуется."
    echo ""
    exit 0
fi

log_info "Найдены новые изменения!"
echo ""

# Показываем изменения
log_step "Изменения в новой версии:"
git log --oneline $CURRENT_COMMIT..$LATEST_COMMIT
echo ""

# Подтверждение деплоя (опционально, можно убрать для полной автоматизации)
read -p "Продолжить деплой? (y/n): " -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    log_warning "Деплой отменен пользователем."
    exit 0
fi
echo ""

# Обновляем код
log_step "Обновление кода из GitHub..."
git pull origin $BRANCH
log_info "Код успешно обновлен!"
echo ""

# Устанавливаем/обновляем зависимости
log_step "Проверка и установка зависимостей..."
if [ -f "package.json" ]; then
    npm install --production
    log_info "Зависимости установлены!"
else
    log_warning "package.json не найден, пропускаем установку зависимостей."
fi
echo ""

# Проверяем, запущен ли бот
log_step "Проверка статуса бота..."
if pm2 status | grep -q "$BOT_NAME"; then
    log_info "Бот найден в PM2, выполняем graceful reload..."
    pm2 reload $BOT_NAME --update-env
    log_info "Бот успешно перезапущен!"
else
    log_warning "Бот не найден в PM2, запускаем..."
    pm2 start bot.js --name $BOT_NAME
    pm2 save
    log_info "Бот запущен!"
fi
echo ""

# Показываем статус
log_step "Статус бота после деплоя:"
pm2 status $BOT_NAME
echo ""

# Показываем последние логи
log_step "Последние логи (20 строк):"
pm2 logs $BOT_NAME --lines 20 --nostream
echo ""

# Сохраняем информацию о деплое
DEPLOY_TIME=$(date '+%Y-%m-%d %H:%M:%S')
echo "$DEPLOY_TIME - Deployed commit $LATEST_COMMIT" >> deploy_history.log

log_info "✅ Деплой успешно завершен!"
log_info "Новая версия: $LATEST_COMMIT"
log_info "Время деплоя: $DEPLOY_TIME"
echo ""
echo -e "${GREEN}╔════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║     Deployment Completed! 🚀           ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════╝${NC}"
