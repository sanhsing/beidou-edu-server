# 北斗教育 前端 v12.1

## 部署至 GitHub Pages

### 步驟

1. 建立 GitHub repo (例: `beidou-edu`)
2. 上傳此資料夾所有 .html 檔案
3. Settings → Pages → Deploy from branch
4. 選擇 `main` branch, `/ (root)` folder
5. 等待部署完成

## API 連接

前端已配置指向後端 API：
```
https://beidou-edu-server-1.onrender.com
```

若需更換，請修改各 HTML 檔案中的 `API_BASE` 變數。

## 頁面清單

| 檔案 | 說明 | 功能 |
|:-----|:-----|:-----|
| index.html | Landing 首頁 | 動態載入統計、科目展示 |
| quiz_ui.html | 測驗介面 | 隨機/科目練習 |
| cert_exam.html | 證照考試 | iPAS、Google AI |
| xtf_starmap.html | 知識星圖 | D3.js 視覺化 |
| xtf_flashcard.html | 字卡複習 | XTF 消拓融記憶 |
| learning_path.html | 學習路徑 | 個人化規劃 |

## 特色

- 純靜態 HTML，無需 build
- 響應式設計 (Tailwind CSS)
- 動態從 API 載入數據
- GA 追蹤已整合

---
北斗七星文創數位有限公司 © 2025
