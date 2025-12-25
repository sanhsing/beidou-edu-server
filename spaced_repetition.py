"""
SM-2 間隔複習排程器
理科線產出 R15

功能：
1. 實現 SuperMemo SM-2 演算法
2. 智能安排複習時間
3. 追蹤記憶強度
"""

import sqlite3
import json
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass
from enum import Enum
import math

class ReviewQuality(Enum):
    """回答品質評級"""
    BLACKOUT = 0      # 完全不記得
    INCORRECT = 1     # 答錯，但看到答案有印象
    HARD = 2          # 答錯，但接近正確
    DIFFICULT = 3     # 正確，但很困難
    GOOD = 4          # 正確，稍有猶豫
    PERFECT = 5       # 完美回答

@dataclass
class ReviewCard:
    """複習卡片"""
    card_id: str
    user_id: str
    question_id: str
    cert_id: str
    
    # SM-2 參數
    easiness: float = 2.5       # 容易度因子 (EF)
    interval: int = 1           # 間隔天數
    repetitions: int = 0        # 正確重複次數
    
    # 追蹤
    next_review: Optional[datetime] = None
    last_review: Optional[datetime] = None
    total_reviews: int = 0
    correct_count: int = 0

class SM2Engine:
    """SM-2 間隔複習引擎"""
    
    # SM-2 參數
    MIN_EASINESS = 1.3
    INITIAL_INTERVALS = [1, 6]  # 第1、2次複習間隔
    
    def __init__(self, db_path: str):
        self.db_path = db_path
        self._ensure_tables()
    
    def _ensure_tables(self):
        """確保複習表存在"""
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        cur.execute('''
            CREATE TABLE IF NOT EXISTS review_cards (
                card_id TEXT PRIMARY KEY,
                user_id TEXT,
                question_id TEXT,
                cert_id TEXT,
                easiness REAL DEFAULT 2.5,
                interval INTEGER DEFAULT 1,
                repetitions INTEGER DEFAULT 0,
                next_review TEXT,
                last_review TEXT,
                total_reviews INTEGER DEFAULT 0,
                correct_count INTEGER DEFAULT 0,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        cur.execute('CREATE INDEX IF NOT EXISTS idx_rc_user ON review_cards(user_id)')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_rc_next ON review_cards(next_review)')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_rc_cert ON review_cards(user_id, cert_id)')
        
        cur.execute('''
            CREATE TABLE IF NOT EXISTS review_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                card_id TEXT,
                user_id TEXT,
                quality INTEGER,
                interval_before INTEGER,
                interval_after INTEGER,
                easiness_before REAL,
                easiness_after REAL,
                reviewed_at TEXT
            )
        ''')
        
        conn.commit()
        conn.close()
    
    def get_or_create_card(self, user_id: str, question_id: str, 
                          cert_id: str) -> ReviewCard:
        """獲取或創建複習卡片"""
        card_id = f"{user_id}:{question_id}"
        
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        cur.execute('''
            SELECT card_id, user_id, question_id, cert_id, easiness, 
                   interval, repetitions, next_review, last_review,
                   total_reviews, correct_count
            FROM review_cards WHERE card_id = ?
        ''', (card_id,))
        
        row = cur.fetchone()
        
        if row:
            card = ReviewCard(
                card_id=row[0],
                user_id=row[1],
                question_id=row[2],
                cert_id=row[3],
                easiness=row[4],
                interval=row[5],
                repetitions=row[6],
                next_review=datetime.fromisoformat(row[7]) if row[7] else None,
                last_review=datetime.fromisoformat(row[8]) if row[8] else None,
                total_reviews=row[9],
                correct_count=row[10]
            )
        else:
            card = ReviewCard(
                card_id=card_id,
                user_id=user_id,
                question_id=question_id,
                cert_id=cert_id,
                next_review=datetime.now()
            )
            
            cur.execute('''
                INSERT INTO review_cards 
                (card_id, user_id, question_id, cert_id, next_review)
                VALUES (?, ?, ?, ?, ?)
            ''', (card_id, user_id, question_id, cert_id, 
                  card.next_review.isoformat()))
        
        conn.commit()
        conn.close()
        
        return card
    
    def process_review(self, card: ReviewCard, quality: int) -> ReviewCard:
        """
        處理複習結果，更新卡片參數
        
        SM-2 演算法:
        1. 如果 quality < 3，重置 repetitions = 0
        2. 更新 easiness: EF = EF + (0.1 - (5-q) * (0.08 + (5-q) * 0.02))
        3. 計算新間隔:
           - n=1: interval = 1
           - n=2: interval = 6
           - n>2: interval = interval * EF
        """
        # 保存舊值
        old_interval = card.interval
        old_easiness = card.easiness
        
        # 更新統計
        card.total_reviews += 1
        if quality >= 3:
            card.correct_count += 1
        
        # SM-2 核心演算法
        if quality < 3:
            # 回答不佳，重置
            card.repetitions = 0
            card.interval = 1
        else:
            # 回答正確
            card.repetitions += 1
            
            if card.repetitions == 1:
                card.interval = self.INITIAL_INTERVALS[0]
            elif card.repetitions == 2:
                card.interval = self.INITIAL_INTERVALS[1]
            else:
                card.interval = int(card.interval * card.easiness)
        
        # 更新容易度因子
        card.easiness = card.easiness + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
        card.easiness = max(self.MIN_EASINESS, card.easiness)
        
        # 計算下次複習時間
        card.last_review = datetime.now()
        card.next_review = card.last_review + timedelta(days=card.interval)
        
        # 保存
        self._save_card(card)
        self._log_review(card, quality, old_interval, old_easiness)
        
        return card
    
    def _save_card(self, card: ReviewCard):
        """保存卡片"""
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        cur.execute('''
            UPDATE review_cards SET
                easiness = ?, interval = ?, repetitions = ?,
                next_review = ?, last_review = ?,
                total_reviews = ?, correct_count = ?
            WHERE card_id = ?
        ''', (card.easiness, card.interval, card.repetitions,
              card.next_review.isoformat() if card.next_review else None,
              card.last_review.isoformat() if card.last_review else None,
              card.total_reviews, card.correct_count, card.card_id))
        
        conn.commit()
        conn.close()
    
    def _log_review(self, card: ReviewCard, quality: int, 
                   old_interval: int, old_easiness: float):
        """記錄複習歷史"""
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        cur.execute('''
            INSERT INTO review_history
            (card_id, user_id, quality, interval_before, interval_after,
             easiness_before, easiness_after, reviewed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''', (card.card_id, card.user_id, quality, old_interval, card.interval,
              old_easiness, card.easiness, datetime.now().isoformat()))
        
        conn.commit()
        conn.close()
    
    def get_due_cards(self, user_id: str, cert_id: str = None,
                     limit: int = 20) -> List[ReviewCard]:
        """獲取待複習卡片"""
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        sql = '''
            SELECT card_id, user_id, question_id, cert_id, easiness,
                   interval, repetitions, next_review, last_review,
                   total_reviews, correct_count
            FROM review_cards
            WHERE user_id = ? AND next_review <= ?
        '''
        params = [user_id, datetime.now().isoformat()]
        
        if cert_id:
            sql += ' AND cert_id = ?'
            params.append(cert_id)
        
        sql += ' ORDER BY next_review LIMIT ?'
        params.append(limit)
        
        cur.execute(sql, params)
        
        cards = []
        for row in cur.fetchall():
            cards.append(ReviewCard(
                card_id=row[0],
                user_id=row[1],
                question_id=row[2],
                cert_id=row[3],
                easiness=row[4],
                interval=row[5],
                repetitions=row[6],
                next_review=datetime.fromisoformat(row[7]) if row[7] else None,
                last_review=datetime.fromisoformat(row[8]) if row[8] else None,
                total_reviews=row[9],
                correct_count=row[10]
            ))
        
        conn.close()
        return cards
    
    def get_review_schedule(self, user_id: str, cert_id: str = None,
                           days: int = 7) -> Dict[str, int]:
        """獲取未來複習排程"""
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        end_date = datetime.now() + timedelta(days=days)
        
        sql = '''
            SELECT DATE(next_review) as review_date, COUNT(*) as count
            FROM review_cards
            WHERE user_id = ? AND next_review BETWEEN ? AND ?
        '''
        params = [user_id, datetime.now().isoformat(), end_date.isoformat()]
        
        if cert_id:
            sql += ' AND cert_id = ?'
            params.append(cert_id)
        
        sql += ' GROUP BY DATE(next_review) ORDER BY review_date'
        
        cur.execute(sql, params)
        
        schedule = {}
        for row in cur.fetchall():
            schedule[row[0]] = row[1]
        
        conn.close()
        return schedule
    
    def get_retention_stats(self, user_id: str, cert_id: str = None) -> Dict:
        """獲取記憶保持統計"""
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        sql = '''
            SELECT 
                COUNT(*) as total_cards,
                SUM(correct_count) as total_correct,
                SUM(total_reviews) as total_reviews,
                AVG(easiness) as avg_easiness,
                AVG(interval) as avg_interval,
                SUM(CASE WHEN repetitions >= 5 THEN 1 ELSE 0 END) as mastered
            FROM review_cards
            WHERE user_id = ?
        '''
        params = [user_id]
        
        if cert_id:
            sql += ' AND cert_id = ?'
            params.append(cert_id)
        
        cur.execute(sql, params)
        row = cur.fetchone()
        
        conn.close()
        
        if row and row[0]:
            retention = row[1] / max(row[2], 1) * 100
            return {
                'total_cards': row[0],
                'total_reviews': row[2],
                'retention_rate': round(retention, 1),
                'avg_easiness': round(row[3], 2),
                'avg_interval_days': round(row[4], 1),
                'mastered_cards': row[5],
                'mastery_rate': round(row[5] / row[0] * 100, 1)
            }
        
        return {'total_cards': 0}
    
    def add_questions_to_deck(self, user_id: str, cert_id: str,
                             question_ids: List[str]) -> int:
        """批次加入題目到複習牌組"""
        count = 0
        for q_id in question_ids:
            self.get_or_create_card(user_id, q_id, cert_id)
            count += 1
        return count
    
    def predict_retention(self, card: ReviewCard, days_since_review: int = 0) -> float:
        """預測記憶保持率（遺忘曲線）"""
        if card.interval == 0:
            return 0.0
        
        # 簡化的遺忘曲線模型
        # R = e^(-t/S) 其中 S = interval * stability_factor
        stability = card.interval * (card.easiness / 2.5)
        t = days_since_review
        retention = math.exp(-t / max(stability, 1))
        
        return round(retention * 100, 1)

# ============================================================
# 測試
# ============================================================

if __name__ == "__main__":
    print("=" * 55)
    print("SM-2 間隔複習排程器 R15 測試")
    print("=" * 55)
    
    engine = SM2Engine('/home/claude/education_v53.db')
    
    user_id = 'test_sm2'
    cert_id = 'CERT001'
    
    # 創建測試卡片
    card = engine.get_or_create_card(user_id, 'Q001', cert_id)
    print(f"\n創建卡片: {card.card_id}")
    print(f"  初始間隔: {card.interval} 天")
    print(f"  容易度: {card.easiness}")
    
    # 模擬複習
    print("\n模擬複習序列:")
    for i, quality in enumerate([4, 5, 3, 4, 5]):
        card = engine.process_review(card, quality)
        print(f"  第{i+1}次 (品質{quality}): 間隔={card.interval}天, EF={card.easiness:.2f}")
    
    # 獲取統計
    stats = engine.get_retention_stats(user_id, cert_id)
    print(f"\n記憶統計:")
    print(f"  卡片數: {stats.get('total_cards', 0)}")
    print(f"  保持率: {stats.get('retention_rate', 0)}%")
    
    # 預測記憶
    retention = engine.predict_retention(card, 3)
    print(f"\n3天後預測保持率: {retention}%")
    
    print("\n✅ R15 SM-2 間隔複習排程器完成")
