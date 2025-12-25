#!/bin/bash
# 北斗教育 v57 啟動腳本

# 下載資料庫 (如果不存在)
if [ ! -f "education.db" ]; then
    echo "📥 下載資料庫..."
    wget -q "https://github.com/sanhsing/beidou-edu/raw/main/education_v56.db" -O education.db || \
    wget -q "https://your-backup-url/education.db" -O education.db || \
    echo "⚠️ 無法下載資料庫，使用本地版本"
fi

export DB_PATH=./education.db
exec gunicorn backend_v57:app --bind 0.0.0.0:${PORT:-5000}
