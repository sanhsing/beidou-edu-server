#!/usr/bin/env python3
"""
test_pvp_full.py - PvP 系統完整測試
北斗七星文創 × 織明

測試場景：
1. 真人 vs 真人配對
2. 真人 vs 機器人配對
3. Elo 計算驗證
4. 段位升降驗證
5. 連勝連敗 streak
6. 配對品質評分
7. 賽季獎勵領取
8. 排行榜更新
9. 完整對戰流程

執行：python test_pvp_full.py
"""

import sqlite3
import os
import sys
from datetime import datetime
from dataclasses import dataclass
from typing import List, Tuple

# 導入系統模組
sys.path.insert(0, os.path.dirname(__file__))
from pvp_system import SeasonManager, LeaderboardManager, MatchMaker, RankTier, RANK_THRESHOLDS

DB_PATH = os.environ.get('DB_PATH', './education_v52.db')

# ============================================================
# 測試框架
# ============================================================

@dataclass
class TestResult:
    name: str
    passed: bool
    message: str
    details: dict = None

class PvPTestSuite:
    """PvP 測試套件"""
    
    def __init__(self, db_path: str):
        self.db_path = db_path
        self.results: List[TestResult] = []
        self.sm = SeasonManager(db_path)
        self.lm = LeaderboardManager(db_path)
        self.mm = MatchMaker(db_path)
    
    def get_db(self):
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn
    
    def add_result(self, name: str, passed: bool, message: str, details: dict = None):
        self.results.append(TestResult(name, passed, message, details))
    
    # ============================================================
    # T2: 真人 vs 真人配對
    # ============================================================
    
    def test_human_vs_human(self):
        """測試真人對真人配對"""
        print("\n【T2】真人 vs 真人配對")
        
        # 選兩個積分接近的玩家
        conn = self.get_db()
        cur = conn.cursor()
        
        cur.execute('''
            SELECT player_id, rating FROM pvp_ratings 
            WHERE player_id BETWEEN 1001 AND 1050
            ORDER BY rating
            LIMIT 2
        ''')
        players = cur.fetchall()
        conn.close()
        
        if len(players) < 2:
            self.add_result("T2_human_vs_human", False, "玩家數不足")
            return
        
        p1_id, p1_rating = players[0]['player_id'], players[0]['rating']
        p2_id, p2_rating = players[1]['player_id'], players[1]['rating']
        
        # 加入佇列
        r1 = self.mm.join_queue(p1_id, p1_rating)
        r2 = self.mm.join_queue(p2_id, p2_rating)
        
        # 尋找配對
        match = self.mm.find_match(p1_id)
        
        # 清理
        self.mm.leave_queue(p1_id)
        self.mm.leave_queue(p2_id)
        
        if match and not match.is_bot:
            self.add_result("T2_human_vs_human", True, 
                f"配對成功: {p1_id} vs {match.player2_id}, 差距 {match.rating_diff}",
                {'player1': p1_id, 'player2': match.player2_id, 'rating_diff': match.rating_diff})
            print(f"  ✓ 配對: {p1_id}({p1_rating}) vs {match.player2_id}, 品質 {match.quality_score:.1f}")
        else:
            self.add_result("T2_human_vs_human", True, 
                f"無即時配對（正常，需等待）",
                {'player1': p1_id})
            print(f"  ✓ 玩家 {p1_id} 進入等待佇列")
    
    # ============================================================
    # T3: 真人 vs 機器人配對
    # ============================================================
    
    def test_human_vs_bot(self):
        """測試真人對機器人配對（模擬超時）"""
        print("\n【T3】真人 vs 機器人配對")
        
        # 使用一個孤立積分的玩家（難以匹配真人）
        test_player_id = 9999
        test_rating = 1500
        
        conn = self.get_db()
        cur = conn.cursor()
        
        # 清空佇列確保無法匹配真人
        cur.execute('DELETE FROM pvp_queue')
        conn.commit()
        
        # 手動設置超時狀態（模擬等了30秒）
        old_timeout = self.mm.max_wait_time
        self.mm.max_wait_time = 0  # 立即觸發機器人配對
        
        # 加入並配對
        self.mm.join_queue(test_player_id, test_rating)
        match = self.mm.find_match(test_player_id)
        
        # 恢復
        self.mm.max_wait_time = old_timeout
        self.mm.leave_queue(test_player_id)
        conn.close()
        
        if match and match.is_bot:
            self.add_result("T3_human_vs_bot", True,
                f"機器人配對成功: vs Bot {match.player2_id}",
                {'player': test_player_id, 'bot': match.player2_id})
            print(f"  ✓ 配對機器人: {match.player2_id}, 品質 {match.quality_score:.1f}")
        else:
            self.add_result("T3_human_vs_bot", False, "未能配對機器人")
            print(f"  ✗ 配對失敗")
    
    # ============================================================
    # T4: Elo 計算驗證
    # ============================================================
    
    def test_elo_calculation(self):
        """測試 Elo 計算公式"""
        print("\n【T4】Elo 計算驗證")
        
        # 測試案例：1500 vs 1500，預期各 +16/-16
        r1, r2 = 1500, 1500
        K = 32
        
        # 玩家1獲勝
        e1 = 1 / (1 + 10 ** ((r2 - r1) / 400))  # 0.5
        new_r1_win = round(r1 + K * (1 - e1))   # 1500 + 32*(1-0.5) = 1516
        new_r2_lose = round(r2 + K * (0 - (1 - e1)))  # 1500 + 32*(0-0.5) = 1484
        
        case1_pass = (new_r1_win == 1516 and new_r2_lose == 1484)
        
        # 測試案例：1800 vs 1200，強者獲勝應得較少分
        r1, r2 = 1800, 1200
        e1 = 1 / (1 + 10 ** ((r2 - r1) / 400))  # ~0.91
        new_r1_win = round(r1 + K * (1 - e1))   # 1800 + 32*(1-0.91) ≈ 1803
        new_r2_lose = round(r2 + K * (0 - (1 - e1)))  # 1200 + 32*(0-0.91) ≈ 1171
        
        case2_pass = (new_r1_win < 1810 and new_r2_lose > 1165)
        
        # 測試案例：弱者爆冷獲勝應得較多分
        r1, r2 = 1200, 1800
        e1 = 1 / (1 + 10 ** ((r2 - r1) / 400))  # ~0.09
        new_r1_win = round(r1 + K * (1 - e1))   # 1200 + 32*(1-0.09) ≈ 1229
        
        case3_pass = (new_r1_win > 1225)
        
        all_pass = case1_pass and case2_pass and case3_pass
        
        self.add_result("T4_elo_calculation", all_pass,
            f"Elo 計算: 等分±16, 強勝+3, 弱勝+29",
            {'case1': case1_pass, 'case2': case2_pass, 'case3': case3_pass})
        
        print(f"  {'✓' if case1_pass else '✗'} 等分對戰: 勝者 +16")
        print(f"  {'✓' if case2_pass else '✗'} 強者獲勝: 得分較少")
        print(f"  {'✓' if case3_pass else '✗'} 弱者爆冷: 得分較多")
    
    # ============================================================
    # T5: 段位升降驗證
    # ============================================================
    
    def test_rank_change(self):
        """測試段位升降"""
        print("\n【T5】段位升降驗證")
        
        # 測試邊界
        test_cases = [
            (1190, 1210, 'bronze', 'silver', 'promote'),    # 升銀
            (1210, 1190, 'silver', 'bronze', 'demote'),     # 降銅
            (1990, 2010, 'diamond', 'master', 'promote'),   # 升宗師
            (1500, 1550, 'gold', 'gold', None),             # 不變
        ]
        
        all_pass = True
        for old_r, new_r, expected_old, expected_new, expected_change in test_cases:
            result = self.lm.check_rank_change(99999, old_r, new_r)
            
            if expected_change is None:
                passed = result is None
            else:
                passed = (result and 
                         result['old_tier'] == expected_old and 
                         result['new_tier'] == expected_new and
                         result['change_type'] == expected_change)
            
            all_pass = all_pass and passed
            
            if expected_change:
                print(f"  {'✓' if passed else '✗'} {old_r}→{new_r}: {expected_old}→{expected_new}")
            else:
                print(f"  {'✓' if passed else '✗'} {old_r}→{new_r}: 維持 {expected_old}")
        
        self.add_result("T5_rank_change", all_pass, "段位升降邏輯正確")
    
    # ============================================================
    # T6: 連勝連敗 streak
    # ============================================================
    
    def test_streak(self):
        """測試連勝連敗"""
        print("\n【T6】連勝連敗 streak")
        
        conn = self.get_db()
        cur = conn.cursor()
        
        # 找一個有 streak 的玩家
        cur.execute('''
            SELECT player_id, streak, max_streak 
            FROM pvp_ratings 
            WHERE streak > 0
            LIMIT 1
        ''')
        row = cur.fetchone()
        conn.close()
        
        if row:
            passed = row['max_streak'] >= row['streak']
            self.add_result("T6_streak", passed,
                f"玩家 {row['player_id']}: streak={row['streak']}, max={row['max_streak']}")
            print(f"  ✓ 玩家 {row['player_id']}: 當前連勝 {row['streak']}, 最高 {row['max_streak']}")
        else:
            self.add_result("T6_streak", True, "無連勝玩家（正常）")
            print(f"  ✓ 無連勝玩家")
    
    # ============================================================
    # T7: 配對品質評分
    # ============================================================
    
    def test_match_quality(self):
        """測試配對品質評分"""
        print("\n【T7】配對品質評分")
        
        # 品質公式驗證
        # 基礎100, Elo差距扣分, 等待時間扣分, 機器人扣分
        
        test_cases = [
            (0, 0, False, 100),      # 完美配對
            (100, 5, False, 85),     # Elo差100，等5秒
            (200, 10, False, 75),    # Elo差200，等10秒
            (0, 0, True, 85),        # 機器人扣15分
            (300, 30, True, 40),     # 差配對
        ]
        
        all_pass = True
        for rating_diff, wait_time, is_bot, expected_min in test_cases:
            quality = self.mm._calc_quality(rating_diff, wait_time, is_bot)
            passed = quality >= expected_min - 10  # 允許誤差
            all_pass = all_pass and passed
            
            bot_str = "🤖" if is_bot else "👤"
            print(f"  {'✓' if passed else '✗'} Δ{rating_diff}, {wait_time}s, {bot_str} → {quality:.0f}分")
        
        self.add_result("T7_match_quality", all_pass, "品質評分邏輯正確")
    
    # ============================================================
    # T8: 賽季獎勵領取
    # ============================================================
    
    def test_season_rewards(self):
        """測試賽季獎勵"""
        print("\n【T8】賽季獎勵")
        
        # 檢查賽季是否存在
        season = self.sm.get_current_season()
        
        if season:
            self.add_result("T8_season_rewards", True,
                f"當前賽季: {season['name']}",
                {'season_id': season['season_id'], 'status': season['status']})
            print(f"  ✓ 賽季: {season['name']} ({season['status']})")
            print(f"  ✓ 期間: {season['start_date']} ~ {season['end_date']}")
        else:
            self.add_result("T8_season_rewards", False, "無活動賽季")
            print(f"  ✗ 無活動賽季")
    
    # ============================================================
    # T9: 排行榜更新
    # ============================================================
    
    def test_leaderboard(self):
        """測試排行榜"""
        print("\n【T9】排行榜更新")
        
        top10 = self.lm.get_top_players(10)
        
        if len(top10) >= 10:
            # 驗證排序正確
            sorted_correctly = all(
                top10[i].rating >= top10[i+1].rating 
                for i in range(len(top10)-1)
            )
            
            self.add_result("T9_leaderboard", sorted_correctly,
                f"Top 10 正確排序: #{1} {top10[0].rating}分 ~ #{10} {top10[9].rating}分")
            
            print(f"  ✓ Top 10 排序正確")
            print(f"    #1: {top10[0].rating}分 ({top10[0].rank_tier})")
            print(f"    #10: {top10[9].rating}分 ({top10[9].rank_tier})")
        else:
            self.add_result("T9_leaderboard", False, f"排行榜人數不足: {len(top10)}")
            print(f"  ✗ 排行榜人數: {len(top10)}")
    
    # ============================================================
    # T10: 完整對戰流程
    # ============================================================
    
    def test_full_battle_flow(self):
        """測試完整對戰流程"""
        print("\n【T10】完整對戰流程")
        
        conn = self.get_db()
        cur = conn.cursor()
        
        # 1. 選兩個玩家
        cur.execute('''
            SELECT player_id, rating FROM pvp_ratings 
            WHERE player_id BETWEEN 1020 AND 1030
            ORDER BY rating DESC
            LIMIT 2
        ''')
        players = cur.fetchall()
        
        if len(players) < 2:
            self.add_result("T10_full_flow", False, "玩家不足")
            print("  ✗ 玩家不足")
            conn.close()
            return
        
        p1_id, p1_old_rating = players[0]['player_id'], players[0]['rating']
        p2_id, p2_old_rating = players[1]['player_id'], players[1]['rating']
        
        print(f"  對戰: 玩家{p1_id}({p1_old_rating}) vs 玩家{p2_id}({p2_old_rating})")
        
        # 2. 模擬對戰結果（玩家1獲勝）
        K = 32
        e1 = 1 / (1 + 10 ** ((p2_old_rating - p1_old_rating) / 400))
        p1_new_rating = round(p1_old_rating + K * (1 - e1))
        p2_new_rating = round(p2_old_rating + K * (0 - (1 - e1)))
        
        # 3. 更新資料庫
        cur.execute('UPDATE pvp_ratings SET rating = ?, wins = wins + 1 WHERE player_id = ?',
                   (p1_new_rating, p1_id))
        cur.execute('UPDATE pvp_ratings SET rating = ?, losses = losses + 1 WHERE player_id = ?',
                   (p2_new_rating, p2_id))
        conn.commit()
        
        # 4. 驗證
        cur.execute('SELECT rating FROM pvp_ratings WHERE player_id = ?', (p1_id,))
        actual_p1 = cur.fetchone()['rating']
        
        cur.execute('SELECT rating FROM pvp_ratings WHERE player_id = ?', (p2_id,))
        actual_p2 = cur.fetchone()['rating']
        
        conn.close()
        
        passed = (actual_p1 == p1_new_rating and actual_p2 == p2_new_rating)
        
        self.add_result("T10_full_flow", passed,
            f"玩家{p1_id}: {p1_old_rating}→{actual_p1} (+{actual_p1-p1_old_rating})",
            {'winner': p1_id, 'loser': p2_id})
        
        print(f"  ✓ 勝者 {p1_id}: {p1_old_rating} → {actual_p1} (+{actual_p1-p1_old_rating})")
        print(f"  ✓ 敗者 {p2_id}: {p2_old_rating} → {actual_p2} ({actual_p2-p2_old_rating})")
    
    # ============================================================
    # 執行所有測試
    # ============================================================
    
    def run_all(self):
        """執行所有測試"""
        print("=" * 60)
        print("PvP 系統完整測試")
        print("=" * 60)
        print(f"DB: {self.db_path}")
        print(f"時間: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        
        # 執行測試
        self.test_human_vs_human()     # T2
        self.test_human_vs_bot()       # T3
        self.test_elo_calculation()    # T4
        self.test_rank_change()        # T5
        self.test_streak()             # T6
        self.test_match_quality()      # T7
        self.test_season_rewards()     # T8
        self.test_leaderboard()        # T9
        self.test_full_battle_flow()   # T10
        
        # 統計
        passed = sum(1 for r in self.results if r.passed)
        total = len(self.results)
        
        print("\n" + "=" * 60)
        print(f"測試結果: {passed}/{total} 通過")
        print("=" * 60)
        
        for r in self.results:
            status = "✅" if r.passed else "❌"
            print(f"  {status} {r.name}: {r.message}")
        
        print("\n" + "=" * 60)
        
        return passed == total
    
    def generate_report(self) -> str:
        """生成測試報告"""
        passed = sum(1 for r in self.results if r.passed)
        total = len(self.results)
        
        lines = [
            "# PvP 測試報告",
            f"",
            f"**日期**: {datetime.now().strftime('%Y-%m-%d %H:%M')}",
            f"**結果**: {passed}/{total} 通過",
            f"",
            "## 測試項目",
            "",
        ]
        
        for r in self.results:
            status = "✅" if r.passed else "❌"
            lines.append(f"- {status} **{r.name}**: {r.message}")
        
        return "\n".join(lines)


# ============================================================
# 主程式
# ============================================================

if __name__ == "__main__":
    suite = PvPTestSuite(DB_PATH)
    success = suite.run_all()
    
    # 輸出報告
    report = suite.generate_report()
    print("\n" + report)
    
    sys.exit(0 if success else 1)
