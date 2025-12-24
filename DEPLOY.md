# 北斗教育前端部署指南

## GitHub Pages 部署步驟

### 1. 建立 Repository

```bash
# 在 GitHub 建立新 repo: beidou-edu-frontend
# 或使用現有 repo
```

### 2. 上傳前端檔案

```bash
cd frontend
git init
git add .
git commit -m "v12.12 - 18 pages complete"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/beidou-edu-frontend.git
git push -u origin main
```

### 3. 啟用 GitHub Pages

1. 進入 Repository → Settings → Pages
2. Source: Deploy from a branch
3. Branch: main / root
4. Save

### 4. 自訂網域（可選）

1. 在 DNS 加入 CNAME 記錄指向 `YOUR_USERNAME.github.io`
2. 在 Settings → Pages → Custom domain 填入網域
3. 勾選 Enforce HTTPS

---

## 環境變數設定

前端不需要 .env，API 位址已硬編碼在各頁面：

```javascript
const API_BASE = 'https://beidou-edu-server-1.onrender.com';
```

如需修改，可批次替換：
```bash
# Mac/Linux
find . -name "*.html" -exec sed -i 's/OLD_URL/NEW_URL/g' {} \;

# Windows PowerShell
Get-ChildItem -Recurse -Filter "*.html" | ForEach-Object {
    (Get-Content $_.FullName) -replace 'OLD_URL', 'NEW_URL' | Set-Content $_.FullName
}
```

---

## 檔案清單

```
frontend/
├── index.html          # Landing Page
├── auth.html           # 登入/註冊
├── dashboard.html      # 儀表板
├── quiz_ui.html        # 測驗介面
├── wrong_book.html     # 錯題本
├── report.html         # 學習報告
├── achievements.html   # 成就徽章
├── leaderboard.html    # 排行榜
├── cert_exam.html      # 證照模擬考
├── xtf_starmap.html    # 知識星圖
├── xtf_flashcard.html  # XTF 字卡
├── learning_path.html  # 學習路徑
├── class.html          # 班級管理
├── class_students.html # 學生名單
├── courses.html        # AI 認證課程
├── course_learn.html   # 課程學習
├── payment_test.html   # 金流測試
├── manifest.json       # PWA 設定
├── sw.js              # Service Worker
└── icons/             # PWA 圖示
```

---

## PWA 設定

manifest.json 已設定：
- App 名稱：北斗教育
- 主題色：#1e1b4b
- 背景色：#111827
- 圖示：72-512px 全套

---

## 驗證部署

部署後檢查：

1. ✅ 首頁載入正常
2. ✅ 登入/註冊功能
3. ✅ API 連線（測驗取題）
4. ✅ PWA 安裝提示
5. ✅ 響應式設計

---

## 常見問題

### Q: 頁面 404
A: 確認 GitHub Pages 已啟用，Branch 設定正確

### Q: API 連線失敗
A: 檢查 Render 後端是否運行，CORS 設定是否包含 GitHub Pages 網域

### Q: PWA 無法安裝
A: 需 HTTPS，GitHub Pages 預設支援

---

**部署完成後的網址格式：**
- GitHub Pages: `https://YOUR_USERNAME.github.io/beidou-edu-frontend/`
- 自訂網域: `https://edu.beidou.com/`
