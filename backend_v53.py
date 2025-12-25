#!/usr/bin/env python3
"""
北斗教育後端 API v53
完整整合版: 基礎 + PvP + 認證

端點總數: 28 個
"""

from flask import Flask
import os

# 建立 app
app = Flask(__name__)
app.config['JSON_AS_ASCII'] = False

# 設定 DB 路徑
DB_PATH = os.environ.get('DB_PATH', './education_v53.db')
os.environ['DB_PATH'] = DB_PATH

# ============================================================
# 導入並註冊各模組
# ============================================================

# 基礎 API (11 端點)
from v51_api import app as base_app
# 複用路由
for rule in base_app.url_map.iter_rules():
    if rule.endpoint != 'static':
        app.add_url_rule(
            rule.rule,
            endpoint=rule.endpoint,
            view_func=base_app.view_functions[rule.endpoint],
            methods=rule.methods - {'OPTIONS', 'HEAD'}
        )

# PvP API (9 端點)
from pvp_api import register_pvp_routes
register_pvp_routes(app)

# 認證 API (8 端點)
from cert_api import register_cert_routes
register_cert_routes(app)

# ============================================================
# 健康檢查 (覆蓋)
# ============================================================

@app.route('/api/health')
def health():
    return {
        'success': True,
        'version': 'v53',
        'modules': {
            'base': 11,
            'pvp': 9,
            'cert': 8
        },
        'total_endpoints': 28
    }

# ============================================================
# 啟動
# ============================================================

if __name__ == '__main__':
    print("=" * 60)
    print("🚀 北斗教育後端 API v53")
    print("=" * 60)
    print(f"📦 DB: {DB_PATH}")
    print("")
    print("【端點統計】")
    print("  基礎 API:   11 端點 (怪獸/成就/稱號/簽到/文案)")
    print("  PvP API:    9 端點  (賽季/排行榜/配對/戰果)")
    print("  認證 API:   8 端點  (課程/術語/進度/模擬考)")
    print("  ─────────────────")
    print("  總計:       28 端點")
    print("")
    print("【認證 API 端點】")
    print("  GET  /api/cert/list")
    print("  GET  /api/cert/:key/path")
    print("  GET  /api/cert/:key/glossary")
    print("  GET  /api/cert/glossary/search")
    print("  POST /api/cert/progress")
    print("  GET  /api/cert/progress/:uid")
    print("  POST /api/cert/exam/start")
    print("  POST /api/cert/exam/submit")
    print("")
    print("=" * 60)
    
    app.run(host='0.0.0.0', port=5000, debug=True)
