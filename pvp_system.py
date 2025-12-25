#!/usr/bin/env python3
"""
pvp_system.py - PvP 完整系統模組
北斗七星文創 × 織明

包含：
- P1 賽季系統 (SeasonManager)
- P2 排行榜系統 (LeaderboardManager)
- P3 配對系統 (MatchMaker)

整合：
- 對接 education_v52.db
- 對接 battle_api_v2.py

執行測試：
    python pvp_system.py
"""

import sqlite3
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass
from enum import Enum
import random
import math

# ============================================================
# 常數與配置
# ============================================================

class RankTier(str, Enum):
    BRONZE = 'bronze'
    SILVER = 'silver'
    GOLD = 'gold'
    PLATINUM = 'platinum'
    DIAMOND = 'diamond'
    MASTER = 'master'
    GRANDMASTER = 'grandmaster'

RANK_THRESHOLDS = {
    RankTier.BRONZE: 0,
    RankTier.SILVER: 1200,
    RankTier.GOLD: 1400,
    RankTier.PLATINUM: 1600,
    RankTier.DIAMOND: 1800,
    RankTier.MASTER: 2000,
    RankTier.GRANDMASTER: 2200,
}

RANK_ICONS = {
    RankTier.BRONZE: '🥉',
    RankTier.SILVER: '🥈',
    RankTier.GOLD: '🥇',
    RankTier.PLATINUM: '💎',
    RankTier.DIAMOND: '💠',
    RankTier.MASTER: '🏆',
    RankTier.GRANDMASTER: '👑',
}

# ============================================================
# 資料結構
# ============================================================

@dataclass
class PlayerRank:
    player_id: int
    rating: int
    rank_tier: str
    rank_position: int
    wins: int
    losses: int
    streak: int

@dataclass
class MatchResult:
    player1_id: int
    player2_id: int
    rating_diff: int
    wait_time: int
    is_bot: bool
    quality_score: float

@dataclass
class SeasonReward:
    rank_tier: str
    coins: int
    exp: int
    title: str
    special_item: Optional[str]

# ============================================================
# P1: 賽季系統
# ============================================================

class SeasonManager:
    """賽季管理器"""
    
    def __init__(self, db_path: str):
        self.db_path = db_path
    
    def get_current_season(self) -> Optional[Dict]:
        """取得當前賽季"""
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        cur.execute('''
            SELECT season_id, name, start_date, end_date, status, soft_reset_pct
            FROM pvp_seasons 
            WHERE status = 'active'
            ORDER BY start_date DESC
            LIMIT 1
        ''')
        row = cur.fetchone()
        conn.close()
        
        if not row:
            return None
        
        return {
            'season_id': row[0],
            'name': row[1],
            'start_date': row[2],
            'end_date': row[3],
            'status': row[4],
            'soft_reset_pct': row[5]
        }
    
    def start_season(self, season_id: str, name: str, duration_days: int = 30) -> Dict:
        """開始新賽季"""
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        # 結束舊賽季
        cur.execute("UPDATE pvp_seasons SET status = 'ended' WHERE status = 'active'")
        
        # 建立新賽季
        start_date = datetime.now().strftime('%Y-%m-%d')
        end_date = (datetime.now() + timedelta(days=duration_days)).strftime('%Y-%m-%d')
        
        cur.execute('''
            INSERT INTO pvp_seasons (season_id, name, start_date, end_date, status)
            VALUES (?, ?, ?, ?, 'active')
        ''', (season_id, name, start_date, end_date))
        
        conn.commit()
        conn.close()
        
        return {'season_id': season_id, 'name': name, 'start_date': start_date, 'end_date': end_date}
    
    def end_season(self, season_id: str) -> Dict:
        """結束賽季並發放獎勵"""
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        # 取得所有玩家最終積分
        cur.execute('''
            SELECT player_id, rating, wins, losses
            FROM pvp_ratings
            WHERE wins + losses > 0
        ''')
        players = cur.fetchall()
        
        rewards_given = 0
        for player_id, rating, wins, losses in players:
            rank_tier = self._get_rank_tier(rating)
            
            # 記錄賽季結果
            cur.execute('''
                INSERT OR REPLACE INTO pvp_player_season 
                (player_id, season_id, final_rating, final_rank, wins, losses, max_rating)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            ''', (player_id, season_id, rating, rank_tier, wins, losses, rating))
            
            rewards_given += 1
        
        # 更新賽季狀態
        cur.execute("UPDATE pvp_seasons SET status = 'ended' WHERE season_id = ?", (season_id,))
        
        conn.commit()
        conn.close()
        
        return {'season_id': season_id, 'players_processed': rewards_given}
    
    def soft_reset_ratings(self, reset_pct: float = 0.5) -> int:
        """軟重置積分（新賽季開始時）"""
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        base_rating = 1200
        
        # 公式：新積分 = 基礎分 + (舊積分 - 基礎分) * 重置比例
        cur.execute('''
            UPDATE pvp_ratings 
            SET rating = ? + CAST((rating - ?) * ? AS INTEGER),
                streak = 0
        ''', (base_rating, base_rating, reset_pct))
        
        affected = cur.rowcount
        conn.commit()
        conn.close()
        
        return affected
    
    def get_season_rewards(self, season_id: str, player_id: int) -> Optional[SeasonReward]:
        """取得賽季獎勵"""
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        # 取得玩家賽季記錄
        cur.execute('''
            SELECT final_rating, final_rank, rewards_claimed
            FROM pvp_player_season
            WHERE player_id = ? AND season_id = ?
        ''', (player_id, season_id))
        row = cur.fetchone()
        
        if not row or row[2] == 1:  # 已領取
            conn.close()
            return None
        
        final_rank = row[1]
        
        # 取得對應獎勵
        cur.execute('''
            SELECT coins, exp, title, special_item
            FROM pvp_season_rewards
            WHERE season_id = ? AND rank_tier = ?
        ''', (season_id, final_rank))
        reward_row = cur.fetchone()
        conn.close()
        
        if not reward_row:
            return None
        
        return SeasonReward(
            rank_tier=final_rank,
            coins=reward_row[0],
            exp=reward_row[1],
            title=reward_row[2],
            special_item=reward_row[3]
        )
    
    def claim_rewards(self, season_id: str, player_id: int) -> bool:
        """領取賽季獎勵"""
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        cur.execute('''
            UPDATE pvp_player_season 
            SET rewards_claimed = 1
            WHERE player_id = ? AND season_id = ? AND rewards_claimed = 0
        ''', (player_id, season_id))
        
        success = cur.rowcount > 0
        conn.commit()
        conn.close()
        
        return success
    
    def _get_rank_tier(self, rating: int) -> str:
        """根據積分取得段位"""
        for tier in reversed(list(RankTier)):
            if rating >= RANK_THRESHOLDS[tier]:
                return tier.value
        return RankTier.BRONZE.value


# ============================================================
# P2: 排行榜系統
# ============================================================

class LeaderboardManager:
    """排行榜管理器"""
    
    def __init__(self, db_path: str):
        self.db_path = db_path
        self._cache = {}
        self._cache_time = None
        self._cache_ttl = 60  # 快取 60 秒
    
    def get_top_players(self, limit: int = 100) -> List[PlayerRank]:
        """取得排行榜前 N 名"""
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        cur.execute('''
            SELECT player_id, rating, rank_tier, rank_position, wins, losses, streak
            FROM pvp_leaderboard
            LIMIT ?
        ''', (limit,))
        
        results = []
        for row in cur.fetchall():
            results.append(PlayerRank(
                player_id=row[0],
                rating=row[1],
                rank_tier=row[2],
                rank_position=row[3],
                wins=row[4],
                losses=row[5],
                streak=row[6]
            ))
        
        conn.close()
        return results
    
    def get_player_rank(self, player_id: int) -> Optional[PlayerRank]:
        """取得玩家排名"""
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        cur.execute('''
            SELECT player_id, rating, rank_tier, rank_position, wins, losses, streak
            FROM pvp_leaderboard
            WHERE player_id = ?
        ''', (player_id,))
        
        row = cur.fetchone()
        conn.close()
        
        if not row:
            return None
        
        return PlayerRank(
            player_id=row[0],
            rating=row[1],
            rank_tier=row[2],
            rank_position=row[3],
            wins=row[4],
            losses=row[5],
            streak=row[6]
        )
    
    def get_rank_distribution(self) -> Dict[str, int]:
        """取得段位分布"""
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        cur.execute('''
            SELECT rank_tier, COUNT(*) as cnt
            FROM pvp_leaderboard
            GROUP BY rank_tier
            ORDER BY MIN(rating) ASC
        ''')
        
        result = {tier.value: 0 for tier in RankTier}
        for row in cur.fetchall():
            result[row[0]] = row[1]
        
        conn.close()
        return result
    
    def get_nearby_players(self, player_id: int, range_size: int = 5) -> List[PlayerRank]:
        """取得玩家附近排名"""
        player = self.get_player_rank(player_id)
        if not player:
            return []
        
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        start_rank = max(1, player.rank_position - range_size)
        end_rank = player.rank_position + range_size
        
        cur.execute('''
            SELECT player_id, rating, rank_tier, rank_position, wins, losses, streak
            FROM pvp_leaderboard
            WHERE rank_position BETWEEN ? AND ?
        ''', (start_rank, end_rank))
        
        results = []
        for row in cur.fetchall():
            results.append(PlayerRank(
                player_id=row[0],
                rating=row[1],
                rank_tier=row[2],
                rank_position=row[3],
                wins=row[4],
                losses=row[5],
                streak=row[6]
            ))
        
        conn.close()
        return results
    
    def check_rank_change(self, player_id: int, old_rating: int, new_rating: int) -> Optional[Dict]:
        """檢查段位變化"""
        old_tier = self._get_tier(old_rating)
        new_tier = self._get_tier(new_rating)
        
        if old_tier == new_tier:
            return None
        
        # 記錄段位變化
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        change_type = 'promote' if RANK_THRESHOLDS[RankTier(new_tier)] > RANK_THRESHOLDS[RankTier(old_tier)] else 'demote'
        
        cur.execute('''
            INSERT INTO pvp_rank_history 
            (player_id, old_rank, new_rank, old_rating, new_rating, change_type)
            VALUES (?, ?, ?, ?, ?, ?)
        ''', (player_id, old_tier, new_tier, old_rating, new_rating, change_type))
        
        conn.commit()
        conn.close()
        
        return {
            'player_id': player_id,
            'old_tier': old_tier,
            'new_tier': new_tier,
            'change_type': change_type,
            'icon': RANK_ICONS.get(RankTier(new_tier), ''),
        }
    
    def _get_tier(self, rating: int) -> str:
        for tier in reversed(list(RankTier)):
            if rating >= RANK_THRESHOLDS[tier]:
                return tier.value
        return RankTier.BRONZE.value


# ============================================================
# P3: 配對系統
# ============================================================

class MatchMaker:
    """配對管理器"""
    
    def __init__(self, db_path: str):
        self.db_path = db_path
        self.initial_elo_range = 200  # 初始 Elo 差距
        self.max_elo_range = 500      # 最大 Elo 差距
        self.elo_expand_rate = 50     # 每 10 秒擴大
        self.max_wait_time = 30       # 最大等待時間
    
    def join_queue(self, player_id: int, rating: int = None) -> Dict:
        """加入配對佇列"""
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        # 取得玩家積分
        if rating is None:
            cur.execute('SELECT rating FROM pvp_ratings WHERE player_id = ?', (player_id,))
            row = cur.fetchone()
            rating = row[0] if row else 1200
        
        # 檢查是否已在佇列
        cur.execute('SELECT 1 FROM pvp_queue WHERE player_id = ?', (player_id,))
        if cur.fetchone():
            conn.close()
            return {'success': False, 'error': '已在配對佇列中'}
        
        # 加入佇列
        now = datetime.now().isoformat()
        cur.execute('''
            INSERT INTO pvp_queue (player_id, status, rating, queue_time, elo_range)
            VALUES (?, 'waiting', ?, ?, ?)
        ''', (player_id, rating, now, self.initial_elo_range))
        
        conn.commit()
        conn.close()
        
        return {'success': True, 'player_id': player_id, 'rating': rating}
    
    def leave_queue(self, player_id: int) -> bool:
        """離開配對佇列"""
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        cur.execute('DELETE FROM pvp_queue WHERE player_id = ?', (player_id,))
        success = cur.rowcount > 0
        
        conn.commit()
        conn.close()
        
        return success
    
    def find_match(self, player_id: int) -> Optional[MatchResult]:
        """尋找配對"""
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        # 取得玩家資訊
        cur.execute('''
            SELECT rating, queue_time, elo_range FROM pvp_queue WHERE player_id = ?
        ''', (player_id,))
        row = cur.fetchone()
        
        if not row:
            conn.close()
            return None
        
        player_rating, queue_time, elo_range = row
        
        # 計算等待時間
        try:
            queue_dt = datetime.fromisoformat(queue_time) if queue_time else datetime.now()
        except:
            queue_dt = datetime.now()
        wait_seconds = (datetime.now() - queue_dt).total_seconds()
        
        # 動態擴大 Elo 範圍
        current_range = min(
            self.initial_elo_range + int(wait_seconds / 10) * self.elo_expand_rate,
            self.max_elo_range
        )
        
        # 尋找匹配的真人玩家
        cur.execute('''
            SELECT player_id, rating, queue_time
            FROM pvp_queue
            WHERE player_id != ?
              AND status = 'waiting'
              AND ABS(rating - ?) <= ?
            ORDER BY ABS(rating - ?) ASC
            LIMIT 1
        ''', (player_id, player_rating, current_range, player_rating))
        
        opponent = cur.fetchone()
        
        if opponent:
            opponent_id, opponent_rating, _ = opponent
            
            # 移除雙方出佇列
            cur.execute('DELETE FROM pvp_queue WHERE player_id IN (?, ?)', (player_id, opponent_id))
            
            # 記錄配對
            rating_diff = abs(player_rating - opponent_rating)
            quality = self._calc_quality(rating_diff, wait_seconds, False)
            
            cur.execute('''
                INSERT INTO pvp_matchmaking_log 
                (player1_id, player2_id, player1_rating, player2_rating, rating_diff, wait_time_seconds, is_bot_match, quality_score)
                VALUES (?, ?, ?, ?, ?, ?, 0, ?)
            ''', (player_id, opponent_id, player_rating, opponent_rating, rating_diff, int(wait_seconds), quality))
            
            conn.commit()
            conn.close()
            
            return MatchResult(
                player1_id=player_id,
                player2_id=opponent_id,
                rating_diff=rating_diff,
                wait_time=int(wait_seconds),
                is_bot=False,
                quality_score=quality
            )
        
        # 等待超時，配對機器人
        if wait_seconds >= self.max_wait_time:
            bot_result = self._match_with_bot(cur, player_id, player_rating, wait_seconds)
            conn.commit()
            conn.close()
            return bot_result
        
        # 更新 Elo 範圍
        cur.execute('UPDATE pvp_queue SET elo_range = ? WHERE player_id = ?', (current_range, player_id))
        conn.commit()
        conn.close()
        
        return None
    
    def _match_with_bot(self, cur, player_id: int, player_rating: int, wait_seconds: float) -> MatchResult:
        """配對機器人"""
        # 找最接近的機器人
        cur.execute('''
            SELECT bot_id, rating FROM pvp_bots
            WHERE active = 1
            ORDER BY ABS(rating - ?) ASC
            LIMIT 1
        ''', (player_rating,))
        
        bot = cur.fetchone()
        if not bot:
            # 沒有機器人，使用預設
            bot_id, bot_rating = 9001, 1200
        else:
            bot_id, bot_rating = bot
        
        # 移出佇列
        cur.execute('DELETE FROM pvp_queue WHERE player_id = ?', (player_id,))
        
        # 記錄配對
        rating_diff = abs(player_rating - bot_rating)
        quality = self._calc_quality(rating_diff, wait_seconds, True)
        
        cur.execute('''
            INSERT INTO pvp_matchmaking_log 
            (player1_id, player2_id, player1_rating, player2_rating, rating_diff, wait_time_seconds, is_bot_match, quality_score)
            VALUES (?, ?, ?, ?, ?, ?, 1, ?)
        ''', (player_id, bot_id, player_rating, bot_rating, rating_diff, int(wait_seconds), quality))
        
        return MatchResult(
            player1_id=player_id,
            player2_id=bot_id,
            rating_diff=rating_diff,
            wait_time=int(wait_seconds),
            is_bot=True,
            quality_score=quality
        )
    
    def _calc_quality(self, rating_diff: int, wait_time: float, is_bot: bool) -> float:
        """計算配對品質 (0-100)"""
        # 基礎分
        base = 100
        
        # Elo 差距扣分 (每 100 差距扣 10 分)
        elo_penalty = min(rating_diff / 10, 50)
        
        # 等待時間扣分 (每 10 秒扣 5 分)
        wait_penalty = min(wait_time / 2, 25)
        
        # 機器人扣分
        bot_penalty = 15 if is_bot else 0
        
        return max(0, base - elo_penalty - wait_penalty - bot_penalty)
    
    def get_queue_status(self) -> Dict:
        """取得佇列狀態"""
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        cur.execute('SELECT COUNT(*) FROM pvp_queue WHERE status = "waiting"')
        count = cur.fetchone()[0]
        
        cur.execute('SELECT AVG(rating) FROM pvp_queue WHERE status = "waiting"')
        avg_rating = cur.fetchone()[0] or 0
        
        conn.close()
        
        return {
            'queue_size': count,
            'avg_rating': int(avg_rating),
            'estimated_wait': '< 30s' if count > 5 else '< 60s'
        }


# ============================================================
# 整合 API 端點
# ============================================================

def get_pvp_api_routes():
    """回傳 FastAPI 路由設定（供 battle_api_v2.py 整合）"""
    return {
        # 賽季
        'GET /pvp/season/current': 'get_current_season',
        'POST /pvp/season/start': 'start_season',
        'POST /pvp/season/end': 'end_season',
        'POST /pvp/season/rewards/claim': 'claim_rewards',
        
        # 排行榜
        'GET /pvp/leaderboard': 'get_top_players',
        'GET /pvp/leaderboard/{player_id}': 'get_player_rank',
        'GET /pvp/leaderboard/nearby/{player_id}': 'get_nearby_players',
        'GET /pvp/ranks/distribution': 'get_rank_distribution',
        
        # 配對
        'POST /pvp/queue/join': 'join_queue',
        'POST /pvp/queue/leave': 'leave_queue',
        'POST /pvp/queue/find': 'find_match',
        'GET /pvp/queue/status': 'get_queue_status',
    }


# ============================================================
# 測試
# ============================================================

if __name__ == "__main__":
    import os
    
    DB_PATH = os.environ.get('DB_PATH', './education_v51.db')
    
    print("=" * 60)
    print("PvP 系統測試")
    print("=" * 60)
    
    # 測試賽季系統
    print("\n【P1 賽季系統】")
    season_mgr = SeasonManager(DB_PATH)
    
    current = season_mgr.get_current_season()
    print(f"  當前賽季: {current}")
    
    # 測試排行榜
    print("\n【P2 排行榜系統】")
    lb_mgr = LeaderboardManager(DB_PATH)
    
    top = lb_mgr.get_top_players(5)
    print(f"  Top 5: {len(top)} 人")
    for p in top:
        print(f"    #{p.rank_position} {RANK_ICONS.get(RankTier(p.rank_tier), '')} 玩家{p.player_id}: {p.rating} 分")
    
    dist = lb_mgr.get_rank_distribution()
    print(f"  段位分布: {dist}")
    
    # 測試配對系統
    print("\n【P3 配對系統】")
    mm = MatchMaker(DB_PATH)
    
    status = mm.get_queue_status()
    print(f"  佇列狀態: {status}")
    
    # 模擬配對
    print("\n  模擬配對測試:")
    
    # 加入佇列
    result1 = mm.join_queue(10001, 1450)
    print(f"    玩家 10001 加入: {result1}")
    
    result2 = mm.join_queue(10002, 1480)
    print(f"    玩家 10002 加入: {result2}")
    
    # 尋找配對
    match = mm.find_match(10001)
    if match:
        print(f"    配對成功!")
        print(f"      對手: {match.player2_id}")
        print(f"      Elo差距: {match.rating_diff}")
        print(f"      品質分數: {match.quality_score:.1f}")
        print(f"      是否機器人: {match.is_bot}")
    else:
        print(f"    配對中...")
    
    # 清理測試資料
    mm.leave_queue(10001)
    mm.leave_queue(10002)
    
    print("\n" + "=" * 60)
    print("✅ PvP 系統測試完成")
    print(f"\n可用 API 端點: {len(get_pvp_api_routes())} 個")
    for route, handler in get_pvp_api_routes().items():
        print(f"  {route}")
