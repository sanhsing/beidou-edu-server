"""
錯題本系統
理科線產出 R17

功能：
1. 錯題記錄與分類
2. 智能錯因分析
3. 錯題複習排程
4. 錯題統計報告
"""

import sqlite3
import json
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, field
from collections import defaultdict
from enum import Enum

class ErrorType(Enum):
    """錯誤類型"""
    CONCEPT = 'concept'           # 概念錯誤
    CALCULATION = 'calculation'   # 計算錯誤
    CARELESS = 'careless'         # 粗心大意
    MISREAD = 'misread'           # 審題錯誤
    GUESS = 'guess'               # 猜測錯誤
    TIMEOUT = 'timeout'           # 超時未答
    UNKNOWN = 'unknown'           # 未分類

class ReviewStatus(Enum):
    """複習狀態"""
    NEW = 'new'                   # 新錯題
    REVIEWING = 'reviewing'       # 複習中
    MASTERED = 'mastered'         # 已掌握
    DIFFICULT = 'difficult'       # 困難題

@dataclass
class WrongRecord:
    """錯題記錄"""
    record_id: str
    user_id: str
    question_id: str
    cert_id: str
    
    # 錯題信息
    user_answer: str
    correct_answer: str
    error_type: ErrorType = ErrorType.UNKNOWN
    
    # 追蹤
    wrong_count: int = 1
    review_count: int = 0
    last_wrong: Optional[datetime] = None
    last_review: Optional[datetime] = None
    status: ReviewStatus = ReviewStatus.NEW
    
    # 分析
    notes: str = ""
    tags: List[str] = field(default_factory=list)

class WrongNotebook:
    """錯題本系統"""
    
    def __init__(self, db_path: str):
        self.db_path = db_path
        self._ensure_tables()
    
    def _ensure_tables(self):
        """確保錯題表存在"""
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        cur.execute('''
            CREATE TABLE IF NOT EXISTS wrong_notebook (
                record_id TEXT PRIMARY KEY,
                user_id TEXT,
                question_id TEXT,
                cert_id TEXT,
                user_answer TEXT,
                correct_answer TEXT,
                error_type TEXT DEFAULT 'unknown',
                wrong_count INTEGER DEFAULT 1,
                review_count INTEGER DEFAULT 0,
                last_wrong TEXT,
                last_review TEXT,
                status TEXT DEFAULT 'new',
                notes TEXT,
                tags TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, question_id)
            )
        ''')
        
        cur.execute('CREATE INDEX IF NOT EXISTS idx_wn_user ON wrong_notebook(user_id)')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_wn_cert ON wrong_notebook(user_id, cert_id)')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_wn_status ON wrong_notebook(user_id, status)')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_wn_type ON wrong_notebook(user_id, error_type)')
        
        # 錯題複習歷史
        cur.execute('''
            CREATE TABLE IF NOT EXISTS wrong_review_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                record_id TEXT,
                user_id TEXT,
                is_correct INTEGER,
                reviewed_at TEXT
            )
        ''')
        
        conn.commit()
        conn.close()
    
    def add_wrong(self, user_id: str, question_id: str, cert_id: str,
                 user_answer: str, correct_answer: str,
                 response_time: int = 0) -> WrongRecord:
        """添加錯題"""
        record_id = f"{user_id}:{question_id}"
        
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        # 檢查是否已存在
        cur.execute('SELECT wrong_count FROM wrong_notebook WHERE record_id = ?', (record_id,))
        existing = cur.fetchone()
        
        # 自動分析錯誤類型
        error_type = self._analyze_error_type(
            question_id, user_answer, correct_answer, response_time
        )
        
        # 獲取題目標籤
        cur.execute('SELECT tags FROM ai_cert_questions_v2 WHERE question_id = ?', (question_id,))
        q_row = cur.fetchone()
        tags = json.loads(q_row[0]) if q_row and q_row[0] else []
        
        now = datetime.now().isoformat()
        
        if existing:
            # 更新已存在的錯題
            cur.execute('''
                UPDATE wrong_notebook SET
                    wrong_count = wrong_count + 1,
                    last_wrong = ?,
                    user_answer = ?,
                    error_type = ?,
                    status = 'reviewing'
                WHERE record_id = ?
            ''', (now, user_answer, error_type.value, record_id))
            wrong_count = existing[0] + 1
        else:
            # 新增錯題
            cur.execute('''
                INSERT INTO wrong_notebook
                (record_id, user_id, question_id, cert_id, user_answer, correct_answer,
                 error_type, last_wrong, tags)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (record_id, user_id, question_id, cert_id, user_answer, correct_answer,
                  error_type.value, now, json.dumps(tags)))
            wrong_count = 1
        
        conn.commit()
        conn.close()
        
        return WrongRecord(
            record_id=record_id,
            user_id=user_id,
            question_id=question_id,
            cert_id=cert_id,
            user_answer=user_answer,
            correct_answer=correct_answer,
            error_type=error_type,
            wrong_count=wrong_count,
            tags=tags
        )
    
    def _analyze_error_type(self, question_id: str, user_answer: str,
                           correct_answer: str, response_time: int) -> ErrorType:
        """分析錯誤類型"""
        # 超時
        if response_time > 180:  # 3分鐘
            return ErrorType.TIMEOUT
        
        # 快速作答可能是猜測
        if response_time < 5:
            return ErrorType.GUESS
        
        # 獲取題目信息進行分析
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        cur.execute('''
            SELECT difficulty, question_type, options
            FROM ai_cert_questions_v2 WHERE question_id = ?
        ''', (question_id,))
        row = cur.fetchone()
        conn.close()
        
        if row:
            difficulty = row[0] or 3
            
            # 簡單題答錯 = 粗心
            if difficulty <= 2:
                return ErrorType.CARELESS
            
            # 難題答錯 = 概念問題
            if difficulty >= 4:
                return ErrorType.CONCEPT
        
        return ErrorType.UNKNOWN
    
    def review_wrong(self, user_id: str, question_id: str,
                    is_correct: bool) -> Dict:
        """複習錯題"""
        record_id = f"{user_id}:{question_id}"
        
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        now = datetime.now().isoformat()
        
        # 獲取當前狀態
        cur.execute('''
            SELECT review_count, wrong_count, status
            FROM wrong_notebook WHERE record_id = ?
        ''', (record_id,))
        row = cur.fetchone()
        
        if not row:
            conn.close()
            return {'error': 'Record not found'}
        
        review_count = row[0] + 1
        wrong_count = row[1]
        
        # 決定新狀態
        if is_correct:
            # 連續答對3次視為掌握
            if review_count >= 3:
                new_status = ReviewStatus.MASTERED.value
            else:
                new_status = ReviewStatus.REVIEWING.value
        else:
            # 答錯次數過多視為困難題
            if wrong_count >= 3:
                new_status = ReviewStatus.DIFFICULT.value
            else:
                new_status = ReviewStatus.REVIEWING.value
        
        # 更新記錄
        cur.execute('''
            UPDATE wrong_notebook SET
                review_count = ?,
                last_review = ?,
                status = ?
            WHERE record_id = ?
        ''', (review_count, now, new_status, record_id))
        
        # 記錄歷史
        cur.execute('''
            INSERT INTO wrong_review_history (record_id, user_id, is_correct, reviewed_at)
            VALUES (?, ?, ?, ?)
        ''', (record_id, user_id, 1 if is_correct else 0, now))
        
        conn.commit()
        conn.close()
        
        return {
            'record_id': record_id,
            'is_correct': is_correct,
            'review_count': review_count,
            'new_status': new_status
        }
    
    def get_wrong_list(self, user_id: str, cert_id: str = None,
                      status: str = None, error_type: str = None,
                      limit: int = 50) -> List[Dict]:
        """獲取錯題列表"""
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        sql = '''
            SELECT w.record_id, w.question_id, w.cert_id, w.user_answer,
                   w.correct_answer, w.error_type, w.wrong_count, w.review_count,
                   w.status, w.tags, w.last_wrong,
                   q.question_text, q.difficulty
            FROM wrong_notebook w
            LEFT JOIN ai_cert_questions_v2 q ON w.question_id = q.question_id
            WHERE w.user_id = ?
        '''
        params = [user_id]
        
        if cert_id:
            sql += ' AND w.cert_id = ?'
            params.append(cert_id)
        
        if status:
            sql += ' AND w.status = ?'
            params.append(status)
        
        if error_type:
            sql += ' AND w.error_type = ?'
            params.append(error_type)
        
        sql += ' ORDER BY w.last_wrong DESC LIMIT ?'
        params.append(limit)
        
        cur.execute(sql, params)
        
        results = []
        for row in cur.fetchall():
            results.append({
                'record_id': row[0],
                'question_id': row[1],
                'cert_id': row[2],
                'user_answer': row[3],
                'correct_answer': row[4],
                'error_type': row[5],
                'wrong_count': row[6],
                'review_count': row[7],
                'status': row[8],
                'tags': json.loads(row[9]) if row[9] else [],
                'last_wrong': row[10],
                'question_preview': (row[11] or '')[:100],
                'difficulty': row[12]
            })
        
        conn.close()
        return results
    
    def get_due_reviews(self, user_id: str, cert_id: str = None,
                       limit: int = 20) -> List[Dict]:
        """獲取待複習的錯題"""
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        # 優先級：困難題 > 新錯題 > 複習中
        sql = '''
            SELECT w.question_id, w.cert_id, w.error_type, w.wrong_count,
                   w.status, q.question_text, q.difficulty
            FROM wrong_notebook w
            LEFT JOIN ai_cert_questions_v2 q ON w.question_id = q.question_id
            WHERE w.user_id = ? AND w.status != 'mastered'
        '''
        params = [user_id]
        
        if cert_id:
            sql += ' AND w.cert_id = ?'
            params.append(cert_id)
        
        sql += '''
            ORDER BY 
                CASE w.status 
                    WHEN 'difficult' THEN 1 
                    WHEN 'new' THEN 2 
                    ELSE 3 
                END,
                w.wrong_count DESC
            LIMIT ?
        '''
        params.append(limit)
        
        cur.execute(sql, params)
        
        results = []
        for row in cur.fetchall():
            results.append({
                'question_id': row[0],
                'cert_id': row[1],
                'error_type': row[2],
                'wrong_count': row[3],
                'status': row[4],
                'question_preview': (row[5] or '')[:100],
                'difficulty': row[6]
            })
        
        conn.close()
        return results
    
    def get_stats(self, user_id: str, cert_id: str = None) -> Dict:
        """獲取錯題統計"""
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        base_sql = "FROM wrong_notebook WHERE user_id = ?"
        params = [user_id]
        
        if cert_id:
            base_sql += " AND cert_id = ?"
            params.append(cert_id)
        
        # 總數
        cur.execute(f"SELECT COUNT(*) {base_sql}", params)
        total = cur.fetchone()[0]
        
        # 按狀態
        cur.execute(f'''
            SELECT status, COUNT(*) {base_sql} GROUP BY status
        ''', params)
        by_status = {row[0]: row[1] for row in cur.fetchall()}
        
        # 按錯誤類型
        cur.execute(f'''
            SELECT error_type, COUNT(*) {base_sql} GROUP BY error_type
        ''', params)
        by_type = {row[0]: row[1] for row in cur.fetchall()}
        
        # 本週新增
        week_ago = (datetime.now() - timedelta(days=7)).isoformat()
        cur.execute(f'''
            SELECT COUNT(*) {base_sql} AND last_wrong > ?
        ''', params + [week_ago])
        this_week = cur.fetchone()[0]
        
        conn.close()
        
        return {
            'total': total,
            'by_status': by_status,
            'by_type': by_type,
            'this_week': this_week,
            'mastered': by_status.get('mastered', 0),
            'mastery_rate': round(by_status.get('mastered', 0) / max(total, 1) * 100, 1)
        }
    
    def add_note(self, user_id: str, question_id: str, note: str) -> bool:
        """添加錯題筆記"""
        record_id = f"{user_id}:{question_id}"
        
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        cur.execute('''
            UPDATE wrong_notebook SET notes = ? WHERE record_id = ?
        ''', (note, record_id))
        
        success = cur.rowcount > 0
        conn.commit()
        conn.close()
        
        return success
    
    def delete_wrong(self, user_id: str, question_id: str) -> bool:
        """刪除錯題"""
        record_id = f"{user_id}:{question_id}"
        
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        cur.execute('DELETE FROM wrong_notebook WHERE record_id = ?', (record_id,))
        cur.execute('DELETE FROM wrong_review_history WHERE record_id = ?', (record_id,))
        
        success = cur.rowcount > 0
        conn.commit()
        conn.close()
        
        return success

# ============================================================
# 測試
# ============================================================

if __name__ == "__main__":
    print("=" * 55)
    print("錯題本系統 R17 測試")
    print("=" * 55)
    
    notebook = WrongNotebook('/home/claude/education_v54.db')
    
    user_id = 'test_wrong'
    cert_id = 'CERT001'
    
    # 添加錯題
    print("\n添加錯題...")
    record = notebook.add_wrong(
        user_id, 'Q_TEST_001', cert_id,
        user_answer='B', correct_answer='A',
        response_time=45
    )
    print(f"  記錄: {record.record_id}")
    print(f"  錯誤類型: {record.error_type.value}")
    
    # 複習
    print("\n複習錯題...")
    result = notebook.review_wrong(user_id, 'Q_TEST_001', True)
    print(f"  新狀態: {result.get('new_status')}")
    
    # 統計
    stats = notebook.get_stats(user_id)
    print(f"\n統計:")
    print(f"  總錯題: {stats['total']}")
    print(f"  掌握率: {stats['mastery_rate']}%")
    
    print("\n✅ R17 錯題本系統完成")
