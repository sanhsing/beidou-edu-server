# 北斗教育 - Render 部署指南

## 一、環境變數設定

在 Render Dashboard > Environment 中設定：

### 必要變數

```bash
# 伺服器
NODE_ENV=production
PORT=10000

# MongoDB Atlas
MONGODB_URI=mongodb+srv://sanhsing_db_user:你的密碼@beidou.5hfssts.mongodb.net/beidou?retryWrites=true&w=majority

# JWT
JWT_SECRET=生成一個強密碼，例如: openssl rand -hex 32

# SQLite (題庫路徑)
EDUCATION_DB_PATH=/opt/render/project/src/education.db
```

### ECPay 金流（正式環境）

```bash
# 綠界正式環境
ECPAY_MERCHANT_ID=你的商店ID
ECPAY_HASH_KEY=你的HashKey
ECPAY_HASH_IV=你的HashIV

# 回調網址
ECPAY_RETURN_URL=https://你的網域/payment-result
ECPAY_NOTIFY_URL=https://你的網域/api/payment/callback
```

### 可選變數

```bash
# Telegram 通知
TELEGRAM_BOT_TOKEN=你的Bot Token
TELEGRAM_CHAT_ID=你的Chat ID

# CORS 來源
CORS_ORIGIN=https://你的前端網域
```

---

## 二、部署步驟

### 1. 準備 SQLite 資料庫

```bash
# 方法 A: 使用 deploy_db.ps1 (Windows)
.\deploy_db.ps1

# 方法 B: 手動上傳
# 將 education.db 上傳到 Render 的 /opt/render/project/src/
```

### 2. 連接 GitHub

1. Render Dashboard > New > Web Service
2. 連接你的 GitHub Repo
3. 設定 Build & Deploy：
   - Build Command: `npm install`
   - Start Command: `node server.js`

### 3. 設定環境變數

在 Environment 頁面加入上述所有變數

### 4. 部署

點擊 Deploy 即可

---

## 三、健康檢查

部署後訪問以下端點確認狀態：

```bash
# 健康檢查
GET /health

# API 資訊
GET /api

# 統計
GET /api/stats

# 金流環境
GET /api/payment/env
```

---

## 四、常見問題

### Q1: SQLite 資料庫找不到

**解決**：確認 `EDUCATION_DB_PATH` 環境變數指向正確路徑

### Q2: ECPay 沙箱 vs 正式環境

**判斷**：`NODE_ENV=production` 時使用正式環境
**確認**：呼叫 `/api/payment/env` 查看

### Q3: MongoDB 連線失敗

**檢查**：
1. `MONGODB_URI` 格式正確
2. MongoDB Atlas 白名單加入 `0.0.0.0/0`
3. 密碼無特殊字元（或 URL encode）

### Q4: CORS 錯誤

**解決**：設定 `CORS_ORIGIN` 環境變數為前端網域

---

## 五、監控

### Render 內建

- Logs：即時日誌
- Metrics：CPU/Memory/Bandwidth

### 自訂監控

```bash
# 伺服器狀態
GET /health

# 回應範例
{
  "status": "ok",
  "timestamp": "2025-12-17T12:00:00Z",
  "uptime": 3600,
  "memory": { "used": 128, "total": 512 },
  "database": { "sqlite": "connected", "mongodb": "connected" }
}
```

---

## 六、更新部署

### 自動部署

連接 GitHub 後，push 到 main branch 自動觸發部署

### 手動部署

Render Dashboard > Manual Deploy > Deploy latest commit

---

## 七、資料庫遷移

### 更新 SQLite

```bash
# 本地打包
zip education_v12.12.zip education.db

# 上傳到 Render (使用 Render Shell)
# 或使用 deploy_db.ps1 腳本
```

### MongoDB 無需遷移

Schema 會自動同步

---

*最後更新: 2025-12-17*
