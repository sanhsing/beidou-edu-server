"""
自適應學習演算法
理科線產出 R13

功能：
1. 基於用戶表現動態調整題目難度
2. 智能選題策略
3. 學習效率優化
"""

import sqlite3
import json
import random
import math
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, field
from enum import Enum
from collections import defaultdict

class SelectionStrategy(Enum):
    """選題策略"""
    BALANCED = 'balanced'       # 平衡模式
    CHALLENGE = 'challenge'     # 挑戰模式
    REVIEW = 'review'           # 複習模式
    WEAK_FOCUS = 'weak_focus'   # 弱點強化

@dataclass
class LearnerProfile:
    """學習者檔案"""
    user_id: str
    cert_id: str
    ability_level: float = 0.5      # 能力值 (0-1)
    stability: float = 0.5          # 穩定度 (0-1)
    momentum: float = 0.0           # 學習動量 (-1 to 1)
    domain_abilities: Dict = field(default_factory=dict)
    recent_accuracy: List[float] = field(default_factory=list)
    weak_areas: List[str] = field(default_factory=list)
    strong_areas: List[str] = field(default_factory=list)

@dataclass
class QuestionSelection:
    """題目選擇結果"""
    question_id: str
    difficulty: int
    domain_id: str
    selection_reason: str
    expected_accuracy: float

class AdaptiveLearner:
    """自適應學習引擎"""
    
    # 參數配置
    CONFIG = {
        'ability_update_rate': 0.1,      # 能力更新速率
        'momentum_decay': 0.9,            # 動量衰減
        'target_accuracy': 0.7,           # 目標正確率
        'difficulty_spread': 1,           # 難度範圍
        'recent_window': 20,              # 近期窗口大小
        'weak_threshold': 0.5,            # 弱點閾值
        'strong_threshold': 0.8,          # 強項閾值
    }
    
    def __init__(self, db_path: str):
        self.db_path = db_path
        self.profiles: Dict[str, LearnerProfile] = {}
        self._ensure_tables()
    
    def _ensure_tables(self):
        """確保必要表存在"""
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        cur.execute('''
            CREATE TABLE IF NOT EXISTS adaptive_learner_profiles (
                user_id TEXT,
                cert_id TEXT,
                ability_level REAL DEFAULT 0.5,
                stability REAL DEFAULT 0.5,
                momentum REAL DEFAULT 0,
                domain_abilities TEXT,
                recent_accuracy TEXT,
                weak_areas TEXT,
                strong_areas TEXT,
                updated_at TEXT,
                PRIMARY KEY (user_id, cert_id)
            )
        ''')
        
        cur.execute('''
            CREATE TABLE IF NOT EXISTS adaptive_learning_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT,
                cert_id TEXT,
                question_id TEXT,
                difficulty INTEGER,
                domain_id TEXT,
                is_correct INTEGER,
                response_time INTEGER,
                ability_before REAL,
                ability_after REAL,
                created_at TEXT
            )
        ''')
        
        conn.commit()
        conn.close()
    
    def get_profile(self, user_id: str, cert_id: str) -> LearnerProfile:
        """獲取或創建學習者檔案"""
        key = f"{user_id}:{cert_id}"
        
        if key in self.profiles:
            return self.profiles[key]
        
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        cur.execute('''
            SELECT ability_level, stability, momentum, domain_abilities,
                   recent_accuracy, weak_areas, strong_areas
            FROM adaptive_learner_profiles
            WHERE user_id = ? AND cert_id = ?
        ''', (user_id, cert_id))
        
        row = cur.fetchone()
        conn.close()
        
        if row:
            profile = LearnerProfile(
                user_id=user_id,
                cert_id=cert_id,
                ability_level=row[0],
                stability=row[1],
                momentum=row[2],
                domain_abilities=json.loads(row[3]) if row[3] else {},
                recent_accuracy=json.loads(row[4]) if row[4] else [],
                weak_areas=json.loads(row[5]) if row[5] else [],
                strong_areas=json.loads(row[6]) if row[6] else []
            )
        else:
            profile = LearnerProfile(user_id=user_id, cert_id=cert_id)
        
        self.profiles[key] = profile
        return profile
    
    def save_profile(self, profile: LearnerProfile):
        """保存學習者檔案"""
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        cur.execute('''
            INSERT OR REPLACE INTO adaptive_learner_profiles
            (user_id, cert_id, ability_level, stability, momentum,
             domain_abilities, recent_accuracy, weak_areas, strong_areas, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (
            profile.user_id, profile.cert_id,
            profile.ability_level, profile.stability, profile.momentum,
            json.dumps(profile.domain_abilities),
            json.dumps(profile.recent_accuracy[-self.CONFIG['recent_window']:]),
            json.dumps(profile.weak_areas),
            json.dumps(profile.strong_areas),
            datetime.now().isoformat()
        ))
        
        conn.commit()
        conn.close()
    
    def select_question(self, user_id: str, cert_id: str,
                       strategy: SelectionStrategy = SelectionStrategy.BALANCED,
                       exclude_ids: List[str] = None) -> Optional[QuestionSelection]:
        """智能選題"""
        profile = self.get_profile(user_id, cert_id)
        
        # 計算目標難度
        target_diff = self._calc_target_difficulty(profile, strategy)
        
        # 計算領域權重
        domain_weights = self._calc_domain_weights(profile, strategy)
        
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        # 構建查詢
        exclude_clause = ""
        if exclude_ids:
            placeholders = ','.join(['?'] * len(exclude_ids))
            exclude_clause = f"AND question_id NOT IN ({placeholders})"
        
        # 獲取候選題目
        sql = f'''
            SELECT question_id, difficulty, domain_id
            FROM ai_cert_questions_v2
            WHERE cert_id = ?
            AND difficulty BETWEEN ? AND ?
            {exclude_clause}
            ORDER BY RANDOM()
            LIMIT 50
        '''
        
        params = [cert_id, 
                  max(1, target_diff - self.CONFIG['difficulty_spread']),
                  min(5, target_diff + self.CONFIG['difficulty_spread'])]
        if exclude_ids:
            params.extend(exclude_ids)
        
        cur.execute(sql, params)
        candidates = cur.fetchall()
        conn.close()
        
        if not candidates:
            return None
        
        # 評分選擇
        best_score = -1
        best_question = None
        
        for q_id, diff, domain in candidates:
            score = self._score_question(profile, diff, domain, 
                                        target_diff, domain_weights, strategy)
            if score > best_score:
                best_score = score
                best_question = (q_id, diff, domain)
        
        if best_question:
            expected_acc = self._predict_accuracy(profile, best_question[1])
            reason = self._get_selection_reason(profile, best_question, strategy)
            
            return QuestionSelection(
                question_id=best_question[0],
                difficulty=best_question[1],
                domain_id=best_question[2],
                selection_reason=reason,
                expected_accuracy=expected_acc
            )
        
        return None
    
    def _calc_target_difficulty(self, profile: LearnerProfile,
                               strategy: SelectionStrategy) -> int:
        """計算目標難度"""
        base_diff = 1 + int(profile.ability_level * 4)  # 1-5
        
        if strategy == SelectionStrategy.CHALLENGE:
            return min(5, base_diff + 1)
        elif strategy == SelectionStrategy.REVIEW:
            return max(1, base_diff - 1)
        elif strategy == SelectionStrategy.WEAK_FOCUS:
            # 對弱點領域降低難度
            return max(1, base_diff - 1)
        else:
            # 根據動量調整
            if profile.momentum > 0.3:
                return min(5, base_diff + 1)
            elif profile.momentum < -0.3:
                return max(1, base_diff - 1)
            return base_diff
    
    def _calc_domain_weights(self, profile: LearnerProfile,
                            strategy: SelectionStrategy) -> Dict[str, float]:
        """計算領域權重"""
        weights = defaultdict(lambda: 1.0)
        
        if strategy == SelectionStrategy.WEAK_FOCUS:
            for domain in profile.weak_areas:
                weights[domain] = 2.0
            for domain in profile.strong_areas:
                weights[domain] = 0.5
        elif strategy == SelectionStrategy.REVIEW:
            for domain in profile.strong_areas:
                weights[domain] = 1.5
        
        return weights
    
    def _score_question(self, profile: LearnerProfile, difficulty: int,
                       domain: str, target_diff: int,
                       domain_weights: Dict, strategy: SelectionStrategy) -> float:
        """評分題目"""
        score = 1.0
        
        # 難度匹配分
        diff_distance = abs(difficulty - target_diff)
        score *= (1 - diff_distance * 0.2)
        
        # 領域權重
        score *= domain_weights.get(domain, 1.0)
        
        # 領域能力考量
        domain_ability = profile.domain_abilities.get(domain, 0.5)
        if strategy == SelectionStrategy.WEAK_FOCUS:
            score *= (1.5 - domain_ability)  # 能力低的領域得分高
        
        return max(0, score)
    
    def _predict_accuracy(self, profile: LearnerProfile, difficulty: int) -> float:
        """預測正確率"""
        # 簡化 IRT 模型
        ability_diff = profile.ability_level * 5 - difficulty
        prob = 1 / (1 + math.exp(-ability_diff))
        return round(prob, 2)
    
    def _get_selection_reason(self, profile: LearnerProfile,
                             question: Tuple, strategy: SelectionStrategy) -> str:
        """生成選題原因"""
        q_id, diff, domain = question
        
        reasons = []
        
        if strategy == SelectionStrategy.WEAK_FOCUS and domain in profile.weak_areas:
            reasons.append(f"強化弱點領域 {domain}")
        
        if strategy == SelectionStrategy.CHALLENGE:
            reasons.append("挑戰模式：提高難度")
        elif strategy == SelectionStrategy.REVIEW:
            reasons.append("複習模式：鞏固基礎")
        
        if profile.momentum > 0.3:
            reasons.append("連續答對，提升難度")
        elif profile.momentum < -0.3:
            reasons.append("連續答錯，降低難度")
        
        return '; '.join(reasons) if reasons else f"平衡選題 (難度{diff})"
    
    def record_answer(self, user_id: str, cert_id: str, question_id: str,
                     difficulty: int, domain_id: str, is_correct: bool,
                     response_time: int = 0) -> Dict:
        """記錄答題結果並更新檔案"""
        profile = self.get_profile(user_id, cert_id)
        ability_before = profile.ability_level
        
        # 更新近期正確率
        profile.recent_accuracy.append(1.0 if is_correct else 0.0)
        if len(profile.recent_accuracy) > self.CONFIG['recent_window']:
            profile.recent_accuracy = profile.recent_accuracy[-self.CONFIG['recent_window']:]
        
        # 更新能力值
        expected = self._predict_accuracy(profile, difficulty)
        surprise = (1.0 if is_correct else 0.0) - expected
        profile.ability_level += surprise * self.CONFIG['ability_update_rate']
        profile.ability_level = max(0, min(1, profile.ability_level))
        
        # 更新動量
        profile.momentum = profile.momentum * self.CONFIG['momentum_decay']
        profile.momentum += 0.3 if is_correct else -0.3
        profile.momentum = max(-1, min(1, profile.momentum))
        
        # 更新穩定度
        if len(profile.recent_accuracy) >= 5:
            recent_var = self._calc_variance(profile.recent_accuracy[-10:])
            profile.stability = 1 - min(recent_var * 4, 1)
        
        # 更新領域能力
        if domain_id:
            old_ability = profile.domain_abilities.get(domain_id, 0.5)
            profile.domain_abilities[domain_id] = old_ability + surprise * 0.15
            profile.domain_abilities[domain_id] = max(0, min(1, profile.domain_abilities[domain_id]))
        
        # 更新強弱項
        self._update_weak_strong(profile)
        
        # 保存
        self.save_profile(profile)
        
        # 記錄日誌
        self._log_answer(user_id, cert_id, question_id, difficulty, domain_id,
                        is_correct, response_time, ability_before, profile.ability_level)
        
        return {
            'ability_change': profile.ability_level - ability_before,
            'new_ability': profile.ability_level,
            'momentum': profile.momentum,
            'stability': profile.stability
        }
    
    def _calc_variance(self, values: List[float]) -> float:
        """計算方差"""
        if not values:
            return 0
        mean = sum(values) / len(values)
        return sum((v - mean) ** 2 for v in values) / len(values)
    
    def _update_weak_strong(self, profile: LearnerProfile):
        """更新強弱項"""
        weak = []
        strong = []
        
        for domain, ability in profile.domain_abilities.items():
            if ability < self.CONFIG['weak_threshold']:
                weak.append(domain)
            elif ability > self.CONFIG['strong_threshold']:
                strong.append(domain)
        
        profile.weak_areas = weak
        profile.strong_areas = strong
    
    def _log_answer(self, user_id: str, cert_id: str, question_id: str,
                   difficulty: int, domain_id: str, is_correct: bool,
                   response_time: int, ability_before: float, ability_after: float):
        """記錄答題日誌"""
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        cur.execute('''
            INSERT INTO adaptive_learning_log
            (user_id, cert_id, question_id, difficulty, domain_id, is_correct,
             response_time, ability_before, ability_after, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', (user_id, cert_id, question_id, difficulty, domain_id,
              1 if is_correct else 0, response_time, ability_before, 
              ability_after, datetime.now().isoformat()))
        
        conn.commit()
        conn.close()
    
    def get_learning_stats(self, user_id: str, cert_id: str) -> Dict:
        """獲取學習統計"""
        profile = self.get_profile(user_id, cert_id)
        
        recent_acc = sum(profile.recent_accuracy) / max(len(profile.recent_accuracy), 1)
        
        return {
            'user_id': user_id,
            'cert_id': cert_id,
            'ability_level': round(profile.ability_level, 2),
            'stability': round(profile.stability, 2),
            'momentum': round(profile.momentum, 2),
            'recent_accuracy': round(recent_acc * 100, 1),
            'weak_areas': profile.weak_areas,
            'strong_areas': profile.strong_areas,
            'domain_abilities': {k: round(v, 2) for k, v in profile.domain_abilities.items()},
            'recommended_difficulty': self._calc_target_difficulty(
                profile, SelectionStrategy.BALANCED
            )
        }

# ============================================================
# 測試
# ============================================================

if __name__ == "__main__":
    print("=" * 50)
    print("自適應學習演算法 R13 測試")
    print("=" * 50)
    
    learner = AdaptiveLearner('/home/claude/education_v52.db')
    
    # 模擬學習過程
    user_id = 'test_adaptive'
    cert_id = 'CERT001'
    
    print(f"\n模擬用戶 {user_id} 學習 {cert_id}")
    
    # 初始選題
    selection = learner.select_question(user_id, cert_id)
    if selection:
        print(f"\n初始選題:")
        print(f"  題目: {selection.question_id}")
        print(f"  難度: {selection.difficulty}")
        print(f"  預期正確率: {selection.expected_accuracy}")
        print(f"  原因: {selection.selection_reason}")
    
    # 模擬答題
    print("\n模擬答題...")
    for i, correct in enumerate([True, True, False, True, True, True, False, True]):
        if selection:
            result = learner.record_answer(
                user_id, cert_id, selection.question_id,
                selection.difficulty, selection.domain_id, correct
            )
            selection = learner.select_question(
                user_id, cert_id,
                exclude_ids=[selection.question_id]
            )
    
    # 查看統計
    stats = learner.get_learning_stats(user_id, cert_id)
    print(f"\n學習統計:")
    print(f"  能力值: {stats['ability_level']}")
    print(f"  穩定度: {stats['stability']}")
    print(f"  動量: {stats['momentum']}")
    print(f"  近期正確率: {stats['recent_accuracy']}%")
    print(f"  推薦難度: {stats['recommended_difficulty']}")
    
    print("\n✅ R13 自適應學習演算法完成")
