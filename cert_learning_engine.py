"""
認證學習引擎 - AI認證/IPAS學習系統
理科線產出 R9
"""

import sqlite3
import json
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, field
from enum import Enum

# ============================================================
# 資料結構
# ============================================================

class MasteryLevel(Enum):
    """掌握度等級"""
    UNKNOWN = 0      # 未學習
    LEARNING = 1     # 學習中
    FAMILIAR = 2     # 熟悉
    PROFICIENT = 3   # 精通
    MASTERED = 4     # 掌握

@dataclass
class LearningNode:
    """學習節點"""
    node_id: str
    cert_id: str
    domain_id: str
    title: str
    description: str = ""
    prerequisites: List[str] = field(default_factory=list)
    difficulty: int = 1
    estimated_hours: float = 1.0
    
@dataclass
class UserProgress:
    """用戶學習進度"""
    user_id: str
    node_id: str
    mastery: MasteryLevel = MasteryLevel.UNKNOWN
    correct_count: int = 0
    total_attempts: int = 0
    last_study: Optional[datetime] = None
    time_spent_minutes: int = 0

# ============================================================
# 學習路徑載入器
# ============================================================

class LearningPathLoader:
    """學習路徑載入器"""
    
    def __init__(self, db_path: str):
        self.db_path = db_path
        self._cache = {}
    
    def load_cert_paths(self, cert_id: str) -> List[Dict]:
        """載入認證學習路徑"""
        if cert_id in self._cache:
            return self._cache[cert_id]
        
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        # 從 cert_learning_paths 載入
        cur.execute('''
            SELECT path_id, path_name, domains, estimated_hours, prerequisites
            FROM cert_learning_paths WHERE cert_id = ?
            ORDER BY sequence
        ''', (cert_id,))
        
        paths = []
        for row in cur.fetchall():
            paths.append({
                'path_id': row[0],
                'name': row[1],
                'domains': json.loads(row[2]) if row[2] else [],
                'hours': row[3],
                'prereqs': json.loads(row[4]) if row[4] else []
            })
        
        conn.close()
        self._cache[cert_id] = paths
        return paths
    
    def load_domain_nodes(self, domain_id: str) -> List[LearningNode]:
        """載入領域知識節點"""
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        # 嘗試 AI 認證表
        cur.execute('''
            SELECT node_id, cert_id, domain_id, title, description, prerequisites, difficulty
            FROM ai_cert_knowledge_nodes WHERE domain_id = ?
        ''', (domain_id,))
        
        nodes = []
        for row in cur.fetchall():
            nodes.append(LearningNode(
                node_id=row[0],
                cert_id=row[1],
                domain_id=row[2],
                title=row[3],
                description=row[4] or "",
                prerequisites=json.loads(row[5]) if row[5] else [],
                difficulty=row[6] or 1
            ))
        
        # 如果沒有，嘗試 IPAS 表
        if not nodes:
            cur.execute('''
                SELECT node_id, cert_id, domain_id, title, description, difficulty
                FROM ipas_knowledge_nodes WHERE domain_id = ?
            ''', (domain_id,))
            
            for row in cur.fetchall():
                nodes.append(LearningNode(
                    node_id=row[0],
                    cert_id=row[1] or 'IPAS',
                    domain_id=row[2],
                    title=row[3],
                    description=row[4] or "",
                    difficulty=row[5] or 1
                ))
        
        conn.close()
        return nodes

# ============================================================
# 進度追蹤器
# ============================================================

class ProgressTracker:
    """學習進度追蹤"""
    
    def __init__(self, db_path: str):
        self.db_path = db_path
        self._ensure_tables()
    
    def _ensure_tables(self):
        """確保進度表存在"""
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        cur.execute('''
            CREATE TABLE IF NOT EXISTS cert_user_progress (
                user_id TEXT,
                cert_id TEXT,
                node_id TEXT,
                mastery INTEGER DEFAULT 0,
                correct_count INTEGER DEFAULT 0,
                total_attempts INTEGER DEFAULT 0,
                last_study TEXT,
                time_spent_minutes INTEGER DEFAULT 0,
                PRIMARY KEY (user_id, node_id)
            )
        ''')
        
        cur.execute('''
            CREATE INDEX IF NOT EXISTS idx_progress_user_cert 
            ON cert_user_progress(user_id, cert_id)
        ''')
        
        conn.commit()
        conn.close()
    
    def get_progress(self, user_id: str, node_id: str) -> UserProgress:
        """獲取用戶節點進度"""
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        cur.execute('''
            SELECT mastery, correct_count, total_attempts, last_study, time_spent_minutes
            FROM cert_user_progress WHERE user_id = ? AND node_id = ?
        ''', (user_id, node_id))
        
        row = cur.fetchone()
        conn.close()
        
        if row:
            return UserProgress(
                user_id=user_id,
                node_id=node_id,
                mastery=MasteryLevel(row[0]),
                correct_count=row[1],
                total_attempts=row[2],
                last_study=datetime.fromisoformat(row[3]) if row[3] else None,
                time_spent_minutes=row[4]
            )
        return UserProgress(user_id=user_id, node_id=node_id)
    
    def update_progress(self, user_id: str, node_id: str, cert_id: str,
                       is_correct: bool, time_spent: int = 0):
        """更新學習進度"""
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        # 獲取當前進度
        progress = self.get_progress(user_id, node_id)
        
        # 更新計數
        new_correct = progress.correct_count + (1 if is_correct else 0)
        new_total = progress.total_attempts + 1
        new_time = progress.time_spent_minutes + time_spent
        
        # 計算新掌握度
        new_mastery = self._calculate_mastery(new_correct, new_total)
        
        cur.execute('''
            INSERT OR REPLACE INTO cert_user_progress
            (user_id, cert_id, node_id, mastery, correct_count, total_attempts, 
             last_study, time_spent_minutes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ''', (user_id, cert_id, node_id, new_mastery.value, new_correct, 
              new_total, datetime.now().isoformat(), new_time))
        
        conn.commit()
        conn.close()
        
        return new_mastery
    
    def _calculate_mastery(self, correct: int, total: int) -> MasteryLevel:
        """計算掌握度"""
        if total == 0:
            return MasteryLevel.UNKNOWN
        
        accuracy = correct / total
        
        if total < 3:
            return MasteryLevel.LEARNING
        elif accuracy >= 0.9 and total >= 10:
            return MasteryLevel.MASTERED
        elif accuracy >= 0.8:
            return MasteryLevel.PROFICIENT
        elif accuracy >= 0.6:
            return MasteryLevel.FAMILIAR
        else:
            return MasteryLevel.LEARNING
    
    def get_cert_progress(self, user_id: str, cert_id: str) -> Dict:
        """獲取認證整體進度"""
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        cur.execute('''
            SELECT 
                COUNT(*) as total_nodes,
                SUM(CASE WHEN mastery >= 3 THEN 1 ELSE 0 END) as proficient,
                SUM(CASE WHEN mastery = 4 THEN 1 ELSE 0 END) as mastered,
                AVG(mastery) as avg_mastery,
                SUM(correct_count) as total_correct,
                SUM(total_attempts) as total_attempts,
                SUM(time_spent_minutes) as total_time
            FROM cert_user_progress
            WHERE user_id = ? AND cert_id = ?
        ''', (user_id, cert_id))
        
        row = cur.fetchone()
        conn.close()
        
        if row and row[0]:
            return {
                'total_nodes': row[0],
                'proficient_nodes': row[1] or 0,
                'mastered_nodes': row[2] or 0,
                'avg_mastery': round(row[3] or 0, 2),
                'accuracy': round((row[4] or 0) / max(row[5], 1) * 100, 1),
                'total_time_hours': round((row[6] or 0) / 60, 1)
            }
        return {'total_nodes': 0, 'proficient_nodes': 0, 'mastered_nodes': 0}

# ============================================================
# 學習推薦引擎
# ============================================================

class LearningRecommender:
    """學習推薦引擎"""
    
    def __init__(self, db_path: str):
        self.db_path = db_path
        self.tracker = ProgressTracker(db_path)
        self.loader = LearningPathLoader(db_path)
    
    def recommend_next(self, user_id: str, cert_id: str, count: int = 5) -> List[Dict]:
        """推薦下一學習單元"""
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        # 獲取用戶已學節點
        cur.execute('''
            SELECT node_id, mastery FROM cert_user_progress
            WHERE user_id = ? AND cert_id = ?
        ''', (user_id, cert_id))
        
        user_progress = {row[0]: row[1] for row in cur.fetchall()}
        
        # 獲取認證所有節點
        cur.execute('''
            SELECT node_id, domain_id, title, difficulty
            FROM ai_cert_knowledge_nodes WHERE cert_id = ?
            ORDER BY difficulty
        ''', (cert_id,))
        
        all_nodes = cur.fetchall()
        conn.close()
        
        # 推薦策略：
        # 1. 優先未學習的節點
        # 2. 其次是掌握度低的節點
        # 3. 難度由低到高
        
        recommendations = []
        
        for node in all_nodes:
            node_id, domain_id, title, difficulty = node
            mastery = user_progress.get(node_id, 0)
            
            if mastery < 3:  # 未精通
                priority = (mastery, difficulty)  # 掌握度低+難度低優先
                recommendations.append({
                    'node_id': node_id,
                    'domain_id': domain_id,
                    'title': title,
                    'difficulty': difficulty,
                    'current_mastery': MasteryLevel(mastery).name,
                    'priority': priority
                })
        
        # 排序並返回
        recommendations.sort(key=lambda x: x['priority'])
        return recommendations[:count]
    
    def get_weak_points(self, user_id: str, cert_id: str) -> List[Dict]:
        """獲取弱點領域"""
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        cur.execute('''
            SELECT 
                p.node_id,
                n.domain_id,
                n.title,
                p.mastery,
                p.correct_count,
                p.total_attempts
            FROM cert_user_progress p
            JOIN ai_cert_knowledge_nodes n ON p.node_id = n.node_id
            WHERE p.user_id = ? AND p.cert_id = ? AND p.mastery < 3
            ORDER BY p.mastery, (p.correct_count * 1.0 / MAX(p.total_attempts, 1))
        ''', (user_id, cert_id))
        
        weak_points = []
        for row in cur.fetchall():
            accuracy = row[4] / max(row[5], 1) * 100
            weak_points.append({
                'node_id': row[0],
                'domain_id': row[1],
                'title': row[2],
                'mastery': MasteryLevel(row[3]).name,
                'accuracy': round(accuracy, 1),
                'attempts': row[5]
            })
        
        conn.close()
        return weak_points[:10]

# ============================================================
# 學習統計報告
# ============================================================

class LearningReporter:
    """學習統計報告生成"""
    
    def __init__(self, db_path: str):
        self.db_path = db_path
        self.tracker = ProgressTracker(db_path)
    
    def generate_report(self, user_id: str, cert_id: str) -> Dict:
        """生成學習報告"""
        progress = self.tracker.get_cert_progress(user_id, cert_id)
        
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        # 領域分析
        cur.execute('''
            SELECT 
                n.domain_id,
                COUNT(*) as node_count,
                AVG(p.mastery) as avg_mastery,
                SUM(p.correct_count) as correct,
                SUM(p.total_attempts) as attempts
            FROM cert_user_progress p
            JOIN ai_cert_knowledge_nodes n ON p.node_id = n.node_id
            WHERE p.user_id = ? AND p.cert_id = ?
            GROUP BY n.domain_id
        ''', (user_id, cert_id))
        
        domain_stats = []
        for row in cur.fetchall():
            acc = row[3] / max(row[4], 1) * 100
            domain_stats.append({
                'domain_id': row[0],
                'nodes': row[1],
                'avg_mastery': round(row[2] or 0, 2),
                'accuracy': round(acc, 1)
            })
        
        conn.close()
        
        # 準備度評估
        readiness = self._calculate_readiness(progress)
        
        return {
            'user_id': user_id,
            'cert_id': cert_id,
            'generated_at': datetime.now().isoformat(),
            'overall': progress,
            'domains': domain_stats,
            'readiness': readiness,
            'recommendation': self._get_recommendation(readiness)
        }
    
    def _calculate_readiness(self, progress: Dict) -> str:
        """計算考試準備度"""
        if progress['total_nodes'] == 0:
            return 'NOT_STARTED'
        
        mastery_ratio = progress['mastered_nodes'] / progress['total_nodes']
        proficient_ratio = progress['proficient_nodes'] / progress['total_nodes']
        
        if mastery_ratio >= 0.8:
            return 'READY'
        elif proficient_ratio >= 0.7:
            return 'ALMOST_READY'
        elif proficient_ratio >= 0.5:
            return 'IN_PROGRESS'
        else:
            return 'EARLY_STAGE'
    
    def _get_recommendation(self, readiness: str) -> str:
        """獲取建議"""
        recommendations = {
            'NOT_STARTED': '開始學習基礎概念，建立知識框架',
            'EARLY_STAGE': '持續練習，專注於弱點領域',
            'IN_PROGRESS': '加強模擬考練習，熟悉題型',
            'ALMOST_READY': '做完整模擬考，查漏補缺',
            'READY': '準備充分，可以報名考試！'
        }
        return recommendations.get(readiness, '')

# ============================================================
# 主引擎類別
# ============================================================

class CertLearningEngine:
    """認證學習引擎主類別"""
    
    def __init__(self, db_path: str):
        self.db_path = db_path
        self.loader = LearningPathLoader(db_path)
        self.tracker = ProgressTracker(db_path)
        self.recommender = LearningRecommender(db_path)
        self.reporter = LearningReporter(db_path)
    
    def start_learning(self, user_id: str, cert_id: str) -> Dict:
        """開始學習認證"""
        paths = self.loader.load_cert_paths(cert_id)
        recommendations = self.recommender.recommend_next(user_id, cert_id)
        
        return {
            'cert_id': cert_id,
            'learning_paths': paths,
            'recommended_nodes': recommendations,
            'message': f'開始學習 {cert_id}，共 {len(paths)} 個學習路徑'
        }
    
    def record_study(self, user_id: str, cert_id: str, node_id: str,
                    is_correct: bool, time_spent: int = 0) -> Dict:
        """記錄學習結果"""
        new_mastery = self.tracker.update_progress(
            user_id, node_id, cert_id, is_correct, time_spent
        )
        
        return {
            'node_id': node_id,
            'is_correct': is_correct,
            'new_mastery': new_mastery.name,
            'next_recommendations': self.recommender.recommend_next(user_id, cert_id, 3)
        }
    
    def get_dashboard(self, user_id: str, cert_id: str) -> Dict:
        """獲取學習儀表板"""
        return {
            'progress': self.tracker.get_cert_progress(user_id, cert_id),
            'weak_points': self.recommender.get_weak_points(user_id, cert_id),
            'recommendations': self.recommender.recommend_next(user_id, cert_id),
            'report': self.reporter.generate_report(user_id, cert_id)
        }

# ============================================================
# 測試
# ============================================================

if __name__ == "__main__":
    print("=" * 50)
    print("認證學習引擎 R9 測試")
    print("=" * 50)
    
    # 模擬測試
    engine = CertLearningEngine('/home/claude/v51_work/education_v51.db')
    
    # 測試開始學習
    result = engine.start_learning('test_user', 'CERT001')
    print(f"\n開始學習: {result['message']}")
    print(f"推薦節點: {len(result['recommended_nodes'])} 個")
    
    print("\n✅ R9 認證學習引擎完成")
