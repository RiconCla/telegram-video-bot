#!/bin/bash
# Установка системных зависимостей для telegram-video-bot

set -e

echo "=== Installing system dependencies ==="

# Определяем пакетный менеджер
if command -v apt-get &> /dev/null; then
    echo "Detected apt (Debian/Ubuntu)"
    sudo apt-get update
    sudo apt-get install -y ffmpeg
elif command -v yum &> /dev/null; then
    echo "Detected yum (CentOS/RHEL)"
    sudo yum install -y ffmpeg
elif command -v dnf &> /dev/null; then
    echo "Detected dnf (Fedora)"
    sudo dnf install -y ffmpeg
else
    echo "Unknown package manager. Install ffmpeg manually."
fi

# Установка/обновление yt-dlp
echo "=== Installing yt-dlp ==="
if command -v pip3 &> /dev/null; then
    pip3 install --upgrade yt-dlp
elif command -v pip &> /dev/null; then
    pip install --upgrade yt-dlp
else
    echo "pip not found, downloading yt-dlp binary..."
    sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
    sudo chmod a+rx /usr/local/bin/yt-dlp
fi

# Установка Node.js зависимостей
echo "=== Installing npm dependencies ==="
npm install

# Проверка
echo ""
echo "=== Checking installations ==="
echo -n "yt-dlp: "; yt-dlp --version 2>/dev/null || echo "NOT FOUND"
echo -n "ffmpeg: "; ffmpeg -version 2>&1 | head -1 || echo "NOT FOUND"
echo -n "ffprobe: "; ffprobe -version 2>&1 | head -1 || echo "NOT FOUND"
echo -n "node: "; node --version
echo ""
echo "=== Setup complete ==="
