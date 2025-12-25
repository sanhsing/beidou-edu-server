#!/usr/bin/env python3
"""
backend_v59.py - 北斗教育後端 v59
GSAT 答題 + RPG 戰鬥系統整合版

版本: v59_251226
功能:
  - P1: GSAT 題庫 API (22,475題)
  - P2: RPG 戰鬥 API (PvE/PvP)
  - P3: 怪獸/成就/稱號 API
"""

from flask import Flask, jsonify, request
from flask_cors import CORS
import sqlite3
import json
import os
import random
import hashlib
from datetime import datetime

app = Flask(__name__)
CORS(app)

DB_PATH = os.environ.get('DB_PATH', './education.db')
API_VERSION = 'v59'

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def row_to_dict(row):
    return dict(row) if row else None

def rows_to_list(rows):
    return [dict(r) for r in rows]

# ============================================================
# 健康檢查
# ============================================================

@app.route('/api/health', methods=['GET'])
def health():
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute("SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table'")
        tables = cur.fetchone()['cnt']
        conn.close()
        return jsonify({
            'success': True,
            'data': {'status': 'healthy', 'version': API_VERSION, 'tables': tables}
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ============================================================
# P1: GSAT 題庫 API
# ============================================================

@app.route('/api/gsat/questions', methods=['GET'])
def get_gsat_questions():
    subject = request.args.get('subject', '')
    count = int(request.args.get('count', 10))
    difficulty = request.args.get('difficulty')
    
    try:
        conn = get_db()
        cur = conn.cursor()
        
        sql = '''SELECT id, subject, question, options, answer, explanation,
                 COALESCE(difficulty, 3) as difficulty, subject_category
                 FROM gsat_generated_questions WHERE subject_category IS NOT NULL'''
        params = []
        
        if subject:
            subject_map = {'地球科學': '地科', '公民與社會': '公民'}
            sql += ' AND subject_category = ?'
            params.append(subject_map.get(subject, subject))
        
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
            opts = row['options']
            if isinstance(opts, str):
                try: opts = json.loads(opts)
                except: opts = []
            questions.append({
                'id': row['id'],
                'subject': row['subject_category'] or row['subject'],
                'question': row['question'],
                'options': opts,
                'answer': row['answer'],
                'explanation': row['explanation'],
                'difficulty': row['difficulty']
            })
        
        return jsonify({'success': True, 'data': questions, 'count': len(questions)})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/gsat/subjects', methods=['GET'])
def get_gsat_subjects():
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute('''SELECT subject_category as subject, COUNT(*) as count
                       FROM gsat_generated_questions WHERE subject_category IS NOT NULL
                       GROUP BY subject_category ORDER BY count DESC''')
        rows = cur.fetchall()
        conn.close()
        return jsonify({'success': True, 'data': rows_to_list(rows)})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/gsat/stats', methods=['GET'])
def get_gsat_stats():
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute('SELECT COUNT(*) as total FROM gsat_generated_questions WHERE subject_category IS NOT NULL')
        total = cur.fetchone()['total']
        cur.execute('''SELECT subject_category as subject, COUNT(*) as count
                       FROM gsat_generated_questions WHERE subject_category IS NOT NULL
                       GROUP BY subject_category''')
        by_subject = rows_to_list(cur.fetchall())
        conn.close()
        return jsonify({'success': True, 'data': by_subject, 'total': total})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ============================================================
# P2: RPG 戰鬥 API
# ============================================================

active_battles = {}

def generate_battle_id():
    return hashlib.md5(f"{datetime.now().isoformat()}{random.random()}".encode()).hexdigest()[:12]

@app.route('/api/battle/start', methods=['POST'])
def start_battle():
    data = request.json or {}
    player_id = data.get('player_id', 1)
    monster_id = data.get('monster_id')
    subject = data.get('subject', '')
    
    try:
        conn = get_db()
        cur = conn.cursor()
        
        if monster_id:
            cur.execute('SELECT * FROM rpg_monsters_v3 WHERE monster_id = ?', (monster_id,))
        else:
            sql = 'SELECT * FROM rpg_monsters_v3'
            params = []
            if subject:
                sql += ' WHERE subject = ?'
                params.append(subject)
            sql += ' ORDER BY RANDOM() LIMIT 1'
            cur.execute(sql, params)
        
        monster = cur.fetchone()
        if not monster:
            return jsonify({'success': False, 'error': 'Monster not found'}), 404
        monster = row_to_dict(monster)
        
        cur.execute('''SELECT id, question, options, answer, explanation, difficulty
                       FROM gsat_generated_questions WHERE subject_category = ?
                       ORDER BY RANDOM() LIMIT 5''', (monster.get('subject', '數學'),))
        questions = rows_to_list(cur.fetchall())
        
        for q in questions:
            if isinstance(q['options'], str):
                try: q['options'] = json.loads(q['options'])
                except: q['options'] = []
        
        conn.close()
        
        battle_id = generate_battle_id()
        battle = {
            'battle_id': battle_id, 'player_id': player_id,
            'monster': monster, 'questions': questions,
            'current_question': 0, 'player_hp': 100,
            'monster_hp': monster.get('hp', 100),
            'max_monster_hp': monster.get('hp', 100),
            'combo': 0, 'score': 0, 'status': 'active'
        }
        active_battles[battle_id] = battle
        
        first_q = questions[0].copy()
        del first_q['answer'], first_q['explanation']
        
        return jsonify({
            'success': True,
            'data': {
                'battle_id': battle_id,
                'monster': {'id': monster.get('monster_id'), 'name': monster.get('name'),
                           'hp': monster.get('hp', 100), 'subject': monster.get('subject'),
                           'element': monster.get('element')},
                'player_hp': 100, 'monster_hp': monster.get('hp', 100),
                'total_questions': len(questions), 'current_question': first_q
            }
        })
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/battle/answer', methods=['POST'])
def submit_battle_answer():
    data = request.json or {}
    battle_id = data.get('battle_id')
    answer = data.get('answer')
    
    if not battle_id or battle_id not in active_battles:
        return jsonify({'success': False, 'error': 'Battle not found'}), 404
    
    battle = active_battles[battle_id]
    if battle['status'] != 'active':
        return jsonify({'success': False, 'error': 'Battle ended'}), 400
    
    question = battle['questions'][battle['current_question']]
    correct = question['answer']
    correct_idx = ord(correct.upper()) - ord('A') if isinstance(correct, str) and correct.isalpha() else int(correct)
    user_idx = ord(answer.upper()) - ord('A') if isinstance(answer, str) and answer.isalpha() else int(answer)
    
    is_correct = (user_idx == correct_idx)
    base_damage = 20
    combo_bonus = min(battle['combo'] * 2, 10)
    
    if is_correct:
        battle['combo'] += 1
        damage = base_damage + combo_bonus
        battle['monster_hp'] = max(0, battle['monster_hp'] - damage)
        battle['score'] += 10 + battle['combo']
    else:
        battle['combo'] = 0
        damage = 15
        battle['player_hp'] = max(0, battle['player_hp'] - damage)
    
    battle_result, rewards = None, None
    if battle['monster_hp'] <= 0:
        battle['status'] = 'victory'
        battle_result = 'victory'
        rewards = {'exp': 50 + battle['score'], 'coins': 20 + battle['combo'] * 5}
    elif battle['player_hp'] <= 0:
        battle['status'] = 'defeat'
        battle_result = 'defeat'
    elif battle['current_question'] >= len(battle['questions']) - 1:
        battle['status'] = 'victory' if battle['monster_hp'] < battle['max_monster_hp'] * 0.5 else 'defeat'
        battle_result = battle['status']
        if battle_result == 'victory':
            rewards = {'exp': 30, 'coins': 15}
    
    next_question = None
    if battle['status'] == 'active':
        battle['current_question'] += 1
        next_q = battle['questions'][battle['current_question']].copy()
        del next_q['answer'], next_q['explanation']
        next_question = next_q
    
    return jsonify({
        'success': True,
        'data': {
            'is_correct': is_correct, 'correct_answer': correct_idx,
            'explanation': question['explanation'], 'damage': damage,
            'combo': battle['combo'], 'player_hp': battle['player_hp'],
            'monster_hp': battle['monster_hp'], 'score': battle['score'],
            'battle_result': battle_result, 'rewards': rewards,
            'next_question': next_question
        }
    })

@app.route('/api/battle/status/<battle_id>', methods=['GET'])
def get_battle_status(battle_id):
    if battle_id not in active_battles:
        return jsonify({'success': False, 'error': 'Battle not found'}), 404
    battle = active_battles[battle_id]
    return jsonify({
        'success': True,
        'data': {
            'battle_id': battle_id, 'status': battle['status'],
            'player_hp': battle['player_hp'], 'monster_hp': battle['monster_hp'],
            'combo': battle['combo'], 'score': battle['score']
        }
    })

# ============================================================
# P2: 怪獸 API
# ============================================================

@app.route('/api/monsters', methods=['GET'])
def get_monsters():
    subject = request.args.get('subject', '')
    limit = int(request.args.get('limit', 50))
    try:
        conn = get_db()
        cur = conn.cursor()
        sql = 'SELECT * FROM rpg_monsters_v3'
        params = []
        if subject:
            sql += ' WHERE subject = ?'
            params.append(subject)
        sql += ' LIMIT ?'
        params.append(limit)
        cur.execute(sql, params)
        rows = cur.fetchall()
        conn.close()
        return jsonify({'success': True, 'data': rows_to_list(rows)})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/monsters/<monster_id>', methods=['GET'])
def get_monster_detail(monster_id):
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute('SELECT * FROM rpg_monsters_v3 WHERE monster_id = ?', (monster_id,))
        monster = cur.fetchone()
        if not monster:
            return jsonify({'success': False, 'error': 'Not found'}), 404
        monster = row_to_dict(monster)
        cur.execute('SELECT * FROM rpg_monster_dialogues WHERE monster_id = ?', (monster_id,))
        dialogues = cur.fetchone()
        if dialogues:
            monster['dialogues'] = row_to_dict(dialogues)
        conn.close()
        return jsonify({'success': True, 'data': monster})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/monsters/subjects', methods=['GET'])
def get_monster_subjects():
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute('SELECT subject, COUNT(*) as count FROM rpg_monsters_v3 GROUP BY subject')
        rows = cur.fetchall()
        conn.close()
        return jsonify({'success': True, 'data': rows_to_list(rows)})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ============================================================
# P2: PvP API
# ============================================================

@app.route('/api/pvp/leaderboard', methods=['GET'])
def get_pvp_leaderboard():
    limit = int(request.args.get('limit', 20))
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute('''SELECT p.player_id, p.display_name, p.rating, p.wins, p.losses,
                       r.display_name as rank_name, r.icon as rank_icon
                       FROM pvp_ratings p
                       LEFT JOIN pvp_ranks r ON p.rating >= r.min_rating AND p.rating <= r.max_rating
                       ORDER BY p.rating DESC LIMIT ?''', (limit,))
        rows = cur.fetchall()
        conn.close()
        return jsonify({'success': True, 'data': rows_to_list(rows)})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/pvp/ranks', methods=['GET'])
def get_pvp_ranks():
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute('SELECT * FROM pvp_ranks ORDER BY min_rating')
        rows = cur.fetchall()
        conn.close()
        return jsonify({'success': True, 'data': rows_to_list(rows)})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/pvp/bots', methods=['GET'])
def get_pvp_bots():
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute('SELECT * FROM pvp_bots WHERE active = 1 ORDER BY rating')
        rows = cur.fetchall()
        conn.close()
        return jsonify({'success': True, 'data': rows_to_list(rows)})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ============================================================
# P2: 玩家/每日/成就/稱號 API
# ============================================================

@app.route('/api/player/<int:player_id>', methods=['GET'])
def get_player(player_id):
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute('SELECT * FROM rpg_players WHERE player_id = ?', (player_id,))
        player = cur.fetchone()
        if not player:
            return jsonify({'success': False, 'error': 'Not found'}), 404
        conn.close()
        return jsonify({'success': True, 'data': row_to_dict(player)})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/daily/status', methods=['GET'])
def get_daily_status():
    player_id = request.args.get('player_id', 1)
    try:
        conn = get_db()
        cur = conn.cursor()
        today = datetime.now().strftime('%Y-%m-%d')
        cur.execute('SELECT * FROM user_daily_rewards WHERE user_id = ? AND DATE(claimed_at) = ?', (player_id, today))
        checked = cur.fetchone()
        cur.execute('SELECT * FROM daily_rewards ORDER BY day_number')
        rewards = cur.fetchall()
        conn.close()
        return jsonify({'success': True, 'data': {'can_check_in': checked is None, 'rewards': rows_to_list(rewards)}})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/daily/checkin', methods=['POST'])
def daily_checkin():
    data = request.json or {}
    player_id = data.get('player_id', 1)
    try:
        conn = get_db()
        cur = conn.cursor()
        today = datetime.now().strftime('%Y-%m-%d')
        cur.execute('SELECT * FROM user_daily_rewards WHERE user_id = ? AND DATE(claimed_at) = ?', (player_id, today))
        if cur.fetchone():
            conn.close()
            return jsonify({'success': False, 'error': 'Already checked in'}), 400
        cur.execute('SELECT COUNT(*) as streak FROM user_daily_rewards WHERE user_id = ? AND DATE(claimed_at) >= DATE(?, \'-7 days\')', (player_id, today))
        streak = (cur.fetchone()['streak'] or 0) + 1
        day_num = ((streak - 1) % 7) + 1
        cur.execute('INSERT INTO user_daily_rewards (user_id, day_number, claimed_at) VALUES (?, ?, ?)', (player_id, day_num, datetime.now().isoformat()))
        conn.commit()
        conn.close()
        return jsonify({'success': True, 'data': {'streak': streak, 'day': day_num}})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/achievements', methods=['GET'])
def get_achievements():
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute('SELECT * FROM rpg_achievements_v2')
        rows = cur.fetchall()
        conn.close()
        return jsonify({'success': True, 'data': rows_to_list(rows)})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/titles', methods=['GET'])
def get_titles():
    rarity = request.args.get('rarity', '')
    try:
        conn = get_db()
        cur = conn.cursor()
        sql = 'SELECT * FROM rpg_titles_v2'
        params = []
        if rarity:
            sql += ' WHERE rarity = ?'
            params.append(rarity)
        cur.execute(sql, params)
        rows = cur.fetchall()
        conn.close()
        return jsonify({'success': True, 'data': rows_to_list(rows)})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/texts/<category>', methods=['GET'])
def get_texts(category):
    try:
        conn = get_db()
        cur = conn.cursor()
        cur.execute('SELECT * FROM game_texts WHERE category = ?', (category,))
        rows = cur.fetchall()
        conn.close()
        return jsonify({'success': True, 'data': rows_to_list(rows)})
    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

# ============================================================
# 主程式
# ============================================================

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    print(f"🚀 北斗教育後端 {API_VERSION}")
    print(f"📚 DB: {DB_PATH} | Port: {port}")
    app.run(host='0.0.0.0', port=port, debug=False)
