#!/usr/bin/env python3
"""
backend_v58.py - 北斗教育後端 v58
修復 GSAT 題庫 API (使用 gsat_generated_questions)

版本: v58_251226
修正: 表名 gsat_dedup_questions → gsat_generated_questions
"""

from flask import Flask, jsonify, request
from flask_cors import CORS
import sqlite3
import json
import os

app = Flask(__name__)
CORS(app)

DB_PATH = os.environ.get('DB_PATH', './education.db')

def get_db():
    return sqlite3.connect(DB_PATH)

# ============================================================
# 健康檢查
# ============================================================

@app.route('/api/health', methods=['GET'])
def health():
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table'")
        tables = cur.fetchone()[0]
        conn.close()
        
        return jsonify({
            'success': True,
            'data': {
                'status': 'healthy',
                'version': 'v58',
                'db': DB_PATH,
                'tables': tables
            }
        })
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# ============================================================
# GSAT 題庫 API (v57 修復)
# ============================================================

@app.route('/api/gsat/questions', methods=['GET'])
def get_gsat_questions():
    """從 gsat_generated_questions 取題目"""
    subject = request.args.get('subject', '')
    count = int(request.args.get('count', 10))
    difficulty = request.args.get('difficulty')
    
    try:
        conn = get_db()
        cur = conn.cursor()
        
        sql = '''
            SELECT id, subject, question, options, answer, explanation,
                   COALESCE(difficulty, 3) as difficulty, subject_category
            FROM gsat_generated_questions 
            WHERE subject_category IS NOT NULL
        '''
        params = []
        
        if subject:
            # 科目名稱對應
            subject_map = {
                '地球科學': '地科',
                '公民與社會': '公民'
            }
            mapped = subject_map.get(subject, subject)
            sql += ' AND subject_category = ?'
            params.append(mapped)
        
        if difficulty:
            sql += ' AND difficulty = ?'
            params.append(int(difficulty))
        
        sql += ' ORDER BY RANDOM() LIMIT ?'
        params.append(count)
        
        cur.execute(sql, params)
        rows = cur.fetchall()
        conn.close()
        
        questions = []
        for row in rows:
            opts = row[3]
            if isinstance(opts, str):
                try:
                    opts = json.loads(opts)
                except:
                    opts = []
            
            questions.append({
                'id': row[0],
                'subject': row[7] or row[1],  # subject_category 優先
                'question': row[2],
                'options': opts,
                'answer': row[4],
                'explanation': row[5],
                'difficulty': row[6]
            })
        
        return jsonify({'success': True, 'data': questions, 'count': len(questions)})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/gsat/subjects', methods=['GET'])
def get_gsat_subjects():
    """列出所有科目"""
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute('''
            SELECT subject_category, COUNT(*) as count
            FROM gsat_generated_questions
            WHERE subject_category IS NOT NULL
            GROUP BY subject_category ORDER BY count DESC
        ''')
        rows = cur.fetchall()
        conn.close()
        
        subjects = [{'subject': r[0], 'count': r[1]} for r in rows]
        return jsonify({'success': True, 'data': subjects})
        
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/gsat/stats', methods=['GET'])
def get_gsat_stats():
    """題庫統計"""
    try:
        conn = get_db()
        cur = conn.cursor()
        
        cur.execute('SELECT COUNT(*) FROM gsat_generated_questions WHERE subject_category IS NOT NULL')
        total = cur.fetchone()[0]
        
        cur.execute('''
            SELECT subject_category, COUNT(*) 
            FROM gsat_generated_questions 
            WHERE subject_category IS NOT NULL
            GROUP BY subject_category
        ''')
        by_subject = {r[0]: r[1] for r in cur.fetchall()}
        
        conn.close()
        
        # 為前端 stats bar 提供格式
        data = [{'subject': k, 'count': v} for k, v in by_subject.items()]
        
        return jsonify({
            'success': True,
            'data': data,
            'total': total,
            'by_subject': by_subject,
            'subjects_count': len(by_subject)
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ============================================================
# 怪獸 API
# ============================================================

@app.route('/api/monsters', methods=['GET'])
def get_monsters():
    """取得怪獸列表"""
    limit = int(request.args.get('limit', 20))
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute('SELECT * FROM monsters LIMIT ?', (limit,))
        cols = [d[0] for d in cur.description]
        rows = cur.fetchall()
        conn.close()
        
        monsters = [dict(zip(cols, r)) for r in rows]
        return jsonify({'success': True, 'data': monsters})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ============================================================
# PvP API
# ============================================================

@app.route('/api/pvp/leaderboard', methods=['GET'])
def get_leaderboard():
    """排行榜"""
    limit = int(request.args.get('limit', 20))
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute('''
            SELECT player_id, rating, wins, losses, tier
            FROM pvp_players
            ORDER BY rating DESC LIMIT ?
        ''', (limit,))
        rows = cur.fetchall()
        conn.close()
        
        players = [{
            'player_id': r[0], 'rating': r[1], 
            'wins': r[2], 'losses': r[3], 'tier': r[4]
        } for r in rows]
        
        return jsonify({'success': True, 'data': players})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/pvp/matchmaking', methods=['POST'])
def matchmaking():
    """配對"""
    data = request.json or {}
    player_id = data.get('player_id', 1)
    
    try:
        conn = get_db()
        cur = conn.cursor()
        
        # 取得玩家 rating
        cur.execute('SELECT rating FROM pvp_players WHERE player_id = ?', (player_id,))
        row = cur.fetchone()
        player_rating = row[0] if row else 1200
        
        # 找對手 (±200 rating)
        cur.execute('''
            SELECT player_id, rating, is_bot
            FROM pvp_players
            WHERE player_id != ? AND rating BETWEEN ? AND ?
            ORDER BY RANDOM() LIMIT 1
        ''', (player_id, player_rating - 200, player_rating + 200))
        
        opponent = cur.fetchone()
        conn.close()
        
        if opponent:
            return jsonify({
                'success': True,
                'data': {
                    'opponent_id': opponent[0],
                    'opponent_rating': opponent[1],
                    'is_bot': bool(opponent[2]) if len(opponent) > 2 else False
                }
            })
        else:
            # 沒找到就配機器人
            return jsonify({
                'success': True,
                'data': {
                    'opponent_id': 9999,
                    'opponent_name': '訓練機器人',
                    'opponent_rating': player_rating,
                    'is_bot': True
                }
            })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ============================================================
# 認證 API
# ============================================================

@app.route('/api/cert/list', methods=['GET'])
def get_cert_list():
    """認證列表"""
    try:
        conn = get_db()
        cur = conn.cursor()
        
        # 嘗試查詢 cert_courses
        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='cert_courses'")
        if cur.fetchone():
            cur.execute('''
                SELECT id, name, description FROM cert_courses
            ''')
            rows = cur.fetchall()
            certs = [{'id': r[0], 'name': r[1], 'description': r[2]} for r in rows]
        else:
            # 預設資料
            certs = [
                {'id': 1, 'name': 'Google AI Essentials', 'cert_key': 'google_ai'},
                {'id': 2, 'name': 'AWS AI Practitioner', 'cert_key': 'aws_ai'},
                {'id': 3, 'name': 'Azure AI-900', 'cert_key': 'azure_ai'},
                {'id': 4, 'name': 'iPAS 資訊安全', 'cert_key': 'ipas'}
            ]
        
        conn.close()
        return jsonify({'success': True, 'data': certs})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/cert/glossary/search', methods=['GET'])
def search_glossary():
    """搜尋術語"""
    q = request.args.get('q', '')
    if len(q) < 2:
        return jsonify({'success': False, 'error': '查詢至少2字'})
    
    try:
        conn = get_db()
        cur = conn.cursor()
        
        cur.execute('''
            SELECT id, term, term_zh, definition
            FROM cert_glossary
            WHERE term LIKE ? OR term_zh LIKE ? OR definition LIKE ?
            LIMIT 20
        ''', (f'%{q}%', f'%{q}%', f'%{q}%'))
        
        rows = cur.fetchall()
        conn.close()
        
        results = [{
            'id': r[0], 'term': r[1], 'term_zh': r[2], 'definition': r[3]
        } for r in rows]
        
        return jsonify({'success': True, 'data': {'results': results, 'count': len(results)}})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/cert/progress/<int:user_id>', methods=['GET'])
def get_progress(user_id):
    """學習進度"""
    try:
        # 簡化版 - 返回空進度
        return jsonify({
            'success': True,
            'data': {
                'user_id': user_id,
                'stats': {}
            }
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ============================================================
# 主程式
# ============================================================

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    print(f"🚀 北斗教育 v58 啟動於 port {port}")
    print(f"📁 DB: {DB_PATH}")
    app.run(host='0.0.0.0', port=port, debug=False)
