#!/usr/bin/env python3
"""
北斗教育 v51 後端 API
整合測試版 - 覆蓋 v51 新功能

端點：
  /monsters, /achievements, /titles, /daily, /texts
"""

from flask import Flask, request, jsonify
from functools import wraps
import sqlite3
from datetime import datetime, timedelta
import os

app = Flask(__name__)
DB_PATH = os.environ.get('DB_PATH', './education_v51.db')

# ============================================================
# A2: 資料庫連線模組
# ============================================================

def get_db():
    """取得資料庫連線"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def api_response(data=None, error=None, status=200):
    """統一回應格式"""
    if error:
        return jsonify({'success': False, 'error': error}), status
    return jsonify({'success': True, 'data': data}), status

# ============================================================
# B1: GET /monsters - 怪獸列表
# ============================================================

@app.route('/api/monsters', methods=['GET'])
def get_monsters():
    """取得怪獸列表"""
    subject = request.args.get('subject')
    limit = request.args.get('limit', 20, type=int)
    
    conn = get_db()
    cur = conn.cursor()
    
    sql = "SELECT monster_id, name_zh, subject, rarity, base_hp, base_attack, emoji FROM rpg_monsters_v3"
    params = []
    
    if subject:
        sql += " WHERE subject = ?"
        params.append(subject)
    
    sql += " LIMIT ?"
    params.append(limit)
    
    cur.execute(sql, params)
    monsters = [dict(row) for row in cur.fetchall()]
    conn.close()
    
    return api_response(monsters)

# ============================================================
# B2: GET /monsters/:id/dialogues - 怪獸對話
# ============================================================

@app.route('/api/monsters/<monster_id>/dialogues', methods=['GET'])
def get_monster_dialogues(monster_id):
    """取得怪獸對話"""
    conn = get_db()
    cur = conn.cursor()
    
    cur.execute('''
        SELECT monster_id, name, subject, appear, hurt, defeat 
        FROM rpg_monster_dialogues WHERE monster_id = ?
    ''', (monster_id,))
    
    row = cur.fetchone()
    conn.close()
    
    if not row:
        return api_response(error='Monster not found', status=404)
    
    return api_response({
        'monster_id': row['monster_id'],
        'name': row['name'],
        'subject': row['subject'],
        'dialogues': {
            'appear': row['appear'],
            'hurt': row['hurt'],
            'defeat': row['defeat']
        }
    })

# ============================================================
# C1: GET /achievements - 成就列表
# ============================================================

@app.route('/api/achievements', methods=['GET'])
def get_achievements():
    """取得成就列表"""
    conn = get_db()
    cur = conn.cursor()
    
    cur.execute('SELECT * FROM rpg_achievements_v2')
    achievements = [dict(row) for row in cur.fetchall()]
    conn.close()
    
    return api_response(achievements)

# ============================================================
# C2: POST /achievements/unlock - 解鎖成就
# ============================================================

@app.route('/api/achievements/unlock', methods=['POST'])
def unlock_achievement():
    """解鎖成就"""
    data = request.get_json()
    user_id = data.get('user_id')
    ach_id = data.get('achievement_id')
    
    if not user_id or not ach_id:
        return api_response(error='Missing user_id or achievement_id', status=400)
    
    conn = get_db()
    cur = conn.cursor()
    
    # 檢查成就是否存在
    cur.execute('SELECT * FROM rpg_achievements_v2 WHERE ach_id = ?', (ach_id,))
    ach = cur.fetchone()
    if not ach:
        conn.close()
        return api_response(error='Achievement not found', status=404)
    
    # 檢查是否已解鎖
    cur.execute('SELECT * FROM rpg_player_achievements WHERE user_id = ? AND achievement_id = ?', 
                (user_id, ach_id))
    if cur.fetchone():
        conn.close()
        return api_response(error='Already unlocked', status=400)
    
    # 解鎖
    cur.execute('''
        INSERT INTO rpg_player_achievements (user_id, achievement_id, unlocked_at)
        VALUES (?, ?, ?)
    ''', (user_id, ach_id, datetime.now().isoformat()))
    
    conn.commit()
    conn.close()
    
    return api_response({
        'unlocked': ach_id,
        'reward_coins': ach['reward_coins'],
        'reward_exp': ach['reward_exp']
    })

# ============================================================
# D1: GET /titles - 稱號列表
# ============================================================

@app.route('/api/titles', methods=['GET'])
def get_titles():
    """取得稱號列表"""
    rarity = request.args.get('rarity')
    
    conn = get_db()
    cur = conn.cursor()
    
    if rarity:
        cur.execute('SELECT * FROM rpg_titles_v2 WHERE rarity = ?', (rarity,))
    else:
        cur.execute('SELECT * FROM rpg_titles_v2')
    
    titles = [dict(row) for row in cur.fetchall()]
    conn.close()
    
    return api_response(titles)

# ============================================================
# D2: POST /titles/equip - 裝備稱號
# ============================================================

@app.route('/api/titles/equip', methods=['POST'])
def equip_title():
    """裝備稱號"""
    data = request.get_json()
    user_id = data.get('user_id')
    title_id = data.get('title_id')
    
    if not user_id or not title_id:
        return api_response(error='Missing user_id or title_id', status=400)
    
    conn = get_db()
    cur = conn.cursor()
    
    # 檢查稱號是否存在
    cur.execute('SELECT * FROM rpg_titles_v2 WHERE title_id = ?', (title_id,))
    title = cur.fetchone()
    if not title:
        conn.close()
        return api_response(error='Title not found', status=404)
    
    # 更新裝備
    cur.execute('''
        INSERT OR REPLACE INTO rpg_player_titles (user_id, title_id, equipped_at)
        VALUES (?, ?, ?)
    ''', (user_id, title_id, datetime.now().isoformat()))
    
    conn.commit()
    conn.close()
    
    return api_response({'equipped': title_id, 'name': title['name']})

# ============================================================
# E1: GET /daily/status - 簽到狀態
# ============================================================

@app.route('/api/daily/status', methods=['GET'])
def get_daily_status():
    """取得簽到狀態"""
    user_id = request.args.get('user_id')
    
    if not user_id:
        return api_response(error='Missing user_id', status=400)
    
    conn = get_db()
    cur = conn.cursor()
    
    cur.execute('SELECT * FROM user_daily_rewards WHERE user_id = ?', (user_id,))
    row = cur.fetchone()
    
    today = datetime.now().strftime('%Y-%m-%d')
    
    if row:
        can_check_in = row['last_check_in'] != today
        data = {
            'streak': row['streak'],
            'total_check_ins': row['total_check_ins'],
            'last_check_in': row['last_check_in'],
            'can_check_in': can_check_in
        }
    else:
        data = {
            'streak': 0,
            'total_check_ins': 0,
            'last_check_in': None,
            'can_check_in': True
        }
    
    # 取得今日獎勵預覽
    day_in_cycle = ((data['streak']) % 7) + 1
    cur.execute('SELECT * FROM daily_rewards WHERE day = ?', (day_in_cycle,))
    reward = cur.fetchone()
    if reward:
        data['next_reward'] = dict(reward)
    
    conn.close()
    return api_response(data)

# ============================================================
# E2: POST /daily/check-in - 執行簽到
# ============================================================

@app.route('/api/daily/check-in', methods=['POST'])
def daily_check_in():
    """執行每日簽到"""
    data = request.get_json()
    user_id = data.get('user_id')
    
    if not user_id:
        return api_response(error='Missing user_id', status=400)
    
    conn = get_db()
    cur = conn.cursor()
    
    today = datetime.now().strftime('%Y-%m-%d')
    yesterday = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')
    
    cur.execute('SELECT * FROM user_daily_rewards WHERE user_id = ?', (user_id,))
    row = cur.fetchone()
    
    if row and row['last_check_in'] == today:
        conn.close()
        return api_response(error='Already checked in today', status=400)
    
    # 計算連續天數
    if row and row['last_check_in'] == yesterday:
        streak = row['streak'] + 1
        total = row['total_check_ins'] + 1
    elif row:
        streak = 1
        total = row['total_check_ins'] + 1
    else:
        streak = 1
        total = 1
    
    # 更新記錄
    cur.execute('''
        INSERT OR REPLACE INTO user_daily_rewards (user_id, last_check_in, streak, total_check_ins)
        VALUES (?, ?, ?, ?)
    ''', (user_id, today, streak, total))
    
    # 取得獎勵
    day_in_cycle = ((streak - 1) % 7) + 1
    cur.execute('SELECT * FROM daily_rewards WHERE day = ?', (day_in_cycle,))
    reward = cur.fetchone()
    
    conn.commit()
    conn.close()
    
    return api_response({
        'streak': streak,
        'day_in_cycle': day_in_cycle,
        'reward': dict(reward) if reward else None
    })

# ============================================================
# F1: GET /texts/:category - 遊戲文案
# ============================================================

@app.route('/api/texts', methods=['GET'])
def get_all_texts():
    """取得所有文案類別"""
    conn = get_db()
    cur = conn.cursor()
    
    cur.execute('SELECT DISTINCT category FROM game_texts')
    categories = [row['category'] for row in cur.fetchall()]
    conn.close()
    
    return api_response(categories)

@app.route('/api/texts/<category>', methods=['GET'])
def get_texts_by_category(category):
    """取得指定類別文案"""
    conn = get_db()
    cur = conn.cursor()
    
    cur.execute('SELECT * FROM game_texts WHERE category = ?', (category,))
    texts = [dict(row) for row in cur.fetchall()]
    conn.close()
    
    if not texts:
        return api_response(error='Category not found', status=404)
    
    return api_response(texts)

# ============================================================
# 健康檢查
# ============================================================

@app.route('/api/health', methods=['GET'])
def health_check():
    """健康檢查"""
    conn = get_db()
    cur = conn.cursor()
    cur.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table'")
    tables = cur.fetchone()[0]
    conn.close()
    
    return api_response({
        'status': 'healthy',
        'db': DB_PATH,
        'tables': tables,
        'version': 'v51'
    })

# ============================================================
# 啟動
# ============================================================

if __name__ == '__main__':
    print(f"🚀 北斗教育 API v51 啟動中...")
    print(f"📦 DB: {DB_PATH}")
    app.run(host='0.0.0.0', port=5000, debug=True)
