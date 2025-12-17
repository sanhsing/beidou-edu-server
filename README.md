# 北斗教育 API Server v12.5

**混合式架構：SQLite (題庫) + MongoDB (用戶)**

---

## 🏗️ 架構

```
┌─────────────────────────────────────────────────┐
│                    前端                          │
│         GitHub Pages / Render Static            │
└─────────────────────┬───────────────────────────┘
                      │ API
┌─────────────────────▼───────────────────────────┐
│              Render Web Service                  │
│  ┌─────────────────┐  ┌─────────────────────┐   │
│  │   SQLite        │  │     MongoDB Atlas   │   │
│  │  education.db   │  │                     │   │
│  │                 │  │ • users             │   │
│  │ • 題庫 20,217   │  │ • answer_records    │   │
│  │ • XTF 771 節點  │  │ • daily_stats       │   │
│  │ • 證照題目      │  │ • achievements      │   │
│  └─────────────────┘  └─────────────────────┘   │
└─────────────────────────────────────────────────┘
```

---

## 🚀 快速部署

### 1. 準備檔案

```bash
# 解壓部署包
unzip beidou_v12.5_hybrid_251217.zip

# 複製 education.db 到 backend/
cp /path/to/education.db backend/
```

### 2. 推送到 GitHub

```bash
cd beidou-edu-server
cp -r backend/* .
git add .
git commit -m "feat: v12.5 混合式架構"
git push
```

### 3. Render 環境變數

| Key | Value |
|:----|:------|
| PORT | 10000 |
| NODE_ENV | production |
| DB_PATH | ./education.db |
| MONGODB_URI | mongodb+srv://sanhsing_db_user:Wra05014a4237@beidou.5hfssts.mongodb.net/beidou?retryWrites=true&w=majority |
| JWT_SECRET | beidou-edu-production-secret-2024 |

### 4. 驗證

```
https://beidou-edu-server-1.onrender.com/health
https://beidou-edu-server-1.onrender.com/api/stats
```

---

## 📡 API 端點

### 題庫 (SQLite)

| 端點 | 說明 |
|:-----|:-----|
| GET /api/stats | 統計數據 |
| GET /api/subjects | 科目列表 |
| GET /api/quiz/subject/:subject | 科目題目 |
| GET /api/xtf-list | XTF 節點 |
| GET /api/cert/:id/questions | 證照題目 |

### 用戶 (MongoDB)

| 端點 | 方法 | 說明 |
|:-----|:----:|:-----|
| /api/user/register | POST | 註冊 |
| /api/user/login | POST | 登入 |
| /api/user/profile | GET | 個人資料 |
| /api/user/record-answer | POST | 記錄答題 |
| /api/user/stats | GET | 學習統計 |

---

## 🔄 更新題庫

```bash
cp education.db beidou-edu-server/
cd beidou-edu-server
git add education.db
git commit -m "update: 題庫更新"
git push
# Render 自動部署
```

---

**北斗七星文創數位有限公司 © 2025**
