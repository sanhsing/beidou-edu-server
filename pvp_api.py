#!/usr/bin/env python3
"""
北斗教育 PvP API
整合 pvp_system.py 到 REST API

端點：8 個
"""

from flask import Blueprint, request, jsonify
import sqlite3
import os
import sys

# 導入 pvp_system
sys.path.insert(0, os.path.dirname(__file__))
from pvp_system import SeasonManager, LeaderboardManager, MatchMaker

pvp_bp = Blueprint('pvp', __name__, url_prefix='/api/pvp')

DB_PATH = os.environ.get('DB_PATH', './education_v52.db')

def api_response(data=None, error=None, status=200):
    if error:
        return jsonify({'success': False, 'error': error}), status
    return jsonify({'success': True, 'data': data}), status

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

# ============================================================
# 1. GET /api/pvp/seasons - 賽季資訊
# ============================================================

@pvp_bp.route('/seasons', methods=['GET'])
def get_seasons():
    """取得賽季資訊"""
    sm = SeasonManager(DB_PATH)
    current = sm.get_current_season()
    return api_response({
        'current_season': current,
        'status': 'active' if current else 'off_season'
    })

# ============================================================
# 2. GET /api/pvp/ranks - 段位列表
# ============================================================

@pvp_bp.route('/ranks', methods=['GET'])
def get_ranks():
    """取得段位列表"""
    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT * FROM pvp_ranks ORDER BY min_rating')
    ranks = [dict(row) for row in cur.fetchall()]
    conn.close()
    return api_response(ranks)

# ============================================================
# 3. GET /api/pvp/leaderboard - 排行榜
# ============================================================

@pvp_bp.route('/leaderboard', methods=['GET'])
def get_leaderboard():
    """取得排行榜"""
    limit = request.args.get('limit', 100, type=int)
    lm = LeaderboardManager(DB_PATH)
    players = lm.get_top_players(limit)
    
    return api_response([{
        'rank': p.rank,
        'player_id': p.player_id,
        'username': p.username,
        'rating': p.rating,
        'tier': p.tier,
        'wins': p.wins,
        'losses': p.losses
    } for p in players])

# ============================================================
# 4. GET /api/pvp/player/:id/rank - 玩家排名
# ============================================================

@pvp_bp.route('/player/<int:player_id>/rank', methods=['GET'])
def get_player_rank(player_id):
    """取得玩家排名"""
    lm = LeaderboardManager(DB_PATH)
    player = lm.get_player_rank(player_id)
    
    if not player:
        return api_response(error='Player not found', status=404)
    
    # 取得附近玩家
    nearby = lm.get_nearby_players(player_id, 5)
    
    return api_response({
        'player': {
            'rank': player.rank,
            'rating': player.rating,
            'tier': player.tier,
            'wins': player.wins,
            'losses': player.losses
        },
        'nearby': [{
            'rank': p.rank,
            'player_id': p.player_id,
            'username': p.username,
            'rating': p.rating
        } for p in nearby]
    })

# ============================================================
# 5. POST /api/pvp/matchmaking - 開始配對
# ============================================================

@pvp_bp.route('/matchmaking', methods=['POST'])
def start_matchmaking():
    """開始配對"""
    data = request.get_json()
    player_id = data.get('player_id')
    
    if not player_id:
        return api_response(error='Missing player_id', status=400)
    
    mm = MatchMaker(DB_PATH)
    
    # 加入佇列
    queue_result = mm.join_queue(player_id)
    
    # 嘗試找到對手
    match = mm.find_match(player_id)
    
    if match:
        return api_response({
            'matched': True,
            'player1_id': match.player1_id,
            'opponent_id': match.player2_id,
            'rating_diff': match.rating_diff,
            'wait_time': match.wait_time,
            'is_bot': match.is_bot,
            'quality_score': match.quality_score
        })
    else:
        return api_response({
            'matched': False,
            'queue_position': queue_result.get('position', 0),
            'estimated_wait': '30秒內配對或匹配機器人'
        })

# ============================================================
# 6. POST /api/pvp/battle/result - 提交戰果
# ============================================================

@pvp_bp.route('/battle/result', methods=['POST'])
def submit_battle_result():
    """提交戰鬥結果"""
    data = request.get_json()
    battle_id = data.get('battle_id')
    winner_id = data.get('winner_id')
    player_score = data.get('player_score', 0)
    opponent_score = data.get('opponent_score', 0)
    
    if not battle_id or not winner_id:
        return api_response(error='Missing battle_id or winner_id', status=400)
    
    conn = get_db()
    cur = conn.cursor()
    
    # 取得戰鬥資訊
    cur.execute('SELECT * FROM pvp_battles WHERE battle_id = ?', (battle_id,))
    battle = cur.fetchone()
    
    if not battle:
        conn.close()
        return api_response(error='Battle not found', status=404)
    
    player1_id = battle['player1_id']
    player2_id = battle['player2_id']
    
    # Elo 計算
    K = 32
    cur.execute('SELECT rating FROM pvp_ratings WHERE player_id = ?', (player1_id,))
    r1 = cur.fetchone()
    r1_rating = r1['rating'] if r1 else 1200
    
    cur.execute('SELECT rating FROM pvp_ratings WHERE player_id = ?', (player2_id,))
    r2 = cur.fetchone()
    r2_rating = r2['rating'] if r2 else 1200
    
    # 期望勝率
    e1 = 1 / (1 + 10 ** ((r2_rating - r1_rating) / 400))
    
    # 實際結果
    s1 = 1 if winner_id == player1_id else 0
    
    # 新評分
    new_r1 = round(r1_rating + K * (s1 - e1))
    new_r2 = round(r2_rating + K * ((1-s1) - (1-e1)))
    
    # 更新評分
    cur.execute('''
        INSERT OR REPLACE INTO pvp_ratings (player_id, rating, wins, losses)
        VALUES (?, ?, 
            COALESCE((SELECT wins FROM pvp_ratings WHERE player_id = ?), 0) + ?,
            COALESCE((SELECT losses FROM pvp_ratings WHERE player_id = ?), 0) + ?)
    ''', (player1_id, new_r1, player1_id, s1, player1_id, 1-s1))
    
    if player2_id < 9000:  # 非機器人
        cur.execute('''
            INSERT OR REPLACE INTO pvp_ratings (player_id, rating, wins, losses)
            VALUES (?, ?,
                COALESCE((SELECT wins FROM pvp_ratings WHERE player_id = ?), 0) + ?,
                COALESCE((SELECT losses FROM pvp_ratings WHERE player_id = ?), 0) + ?)
        ''', (player2_id, new_r2, player2_id, 1-s1, player2_id, s1))
    
    # 記錄戰鬥歷史
    cur.execute('''
        INSERT INTO pvp_match_history 
        (battle_id, player_id, opponent_id, result, rating_change, player_score, opponent_score)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    ''', (battle_id, player1_id, player2_id, 
          'win' if s1 else 'lose', new_r1 - r1_rating, player_score, opponent_score))
    
    conn.commit()
    conn.close()
    
    # 檢查段位變更
    lm = LeaderboardManager(DB_PATH)
    rank_change = lm.check_rank_change(player1_id, r1_rating, new_r1)
    
    return api_response({
        'player_id': player1_id,
        'old_rating': r1_rating,
        'new_rating': new_r1,
        'rating_change': new_r1 - r1_rating,
        'rank_change': rank_change
    })

# ============================================================
# 7. GET /api/pvp/bots - 機器人列表
# ============================================================

@pvp_bp.route('/bots', methods=['GET'])
def get_bots():
    """取得機器人列表"""
    conn = get_db()
    cur = conn.cursor()
    cur.execute('SELECT * FROM pvp_bots WHERE active = 1 ORDER BY rating')
    bots = [dict(row) for row in cur.fetchall()]
    conn.close()
    return api_response(bots)

# ============================================================
# 8. POST /api/pvp/rewards/claim - 領取賽季獎勵
# ============================================================

@pvp_bp.route('/rewards/claim', methods=['POST'])
def claim_rewards():
    """領取賽季獎勵"""
    data = request.get_json()
    player_id = data.get('player_id')
    season_id = data.get('season_id')
    
    if not player_id or not season_id:
        return api_response(error='Missing player_id or season_id', status=400)
    
    sm = SeasonManager(DB_PATH)
    
    # 取得獎勵資訊
    reward = sm.get_season_rewards(season_id, player_id)
    if not reward:
        return api_response(error='No rewards available', status=404)
    
    # 領取
    success = sm.claim_rewards(season_id, player_id)
    
    if success:
        return api_response({
            'claimed': True,
            'reward': {
                'rank_tier': reward.rank_tier,
                'coins': reward.coins,
                'exp': reward.exp,
                'title': reward.title,
                'special_item': reward.special_item
            }
        })
    else:
        return api_response(error='Already claimed or invalid', status=400)

# ============================================================
# 9. GET /api/pvp/queue/status - 配對佇列狀態
# ============================================================

@pvp_bp.route('/queue/status', methods=['GET'])
def get_queue_status():
    """取得配對佇列狀態"""
    mm = MatchMaker(DB_PATH)
    status = mm.get_queue_status()
    return api_response(status)

# ============================================================
# 註冊到主 app
# ============================================================

def register_pvp_routes(app):
    """註冊 PvP 路由到主應用"""
    app.register_blueprint(pvp_bp)
    print("✓ PvP API 已註冊 (9 端點)")

