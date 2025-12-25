"""
認證模擬考系統 - AI認證/IPAS考試模擬
理科線產出 R10
"""

import sqlite3
import json
import random
import time
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, field
from enum import Enum

# ============================================================
# 資料結構
# ============================================================

class ExamStatus(Enum):
    """考試狀態"""
    NOT_STARTED = 'not_started'
    IN_PROGRESS = 'in_progress'
    PAUSED = 'paused'
    COMPLETED = 'completed'
    TIMEOUT = 'timeout'

class QuestionType(Enum):
    """題型"""
    SINGLE = 'single'
    MULTI = 'multi'
    MATCHING = 'matching'
    ORDERING = 'ordering'
    SCENARIO = 'scenario'
    CASE_STUDY = 'case_study'

@dataclass
class ExamConfig:
    """考試配置"""
    cert_id: str
    exam_name: str
    total_questions: int = 60
    time_limit_minutes: int = 90
    passing_score: int = 70
    question_distribution: Dict = field(default_factory=dict)
    
@dataclass
class ExamQuestion:
    """考試題目"""
    question_id: str
    question_type: QuestionType
    question_text: str
    options: List[str]
    correct_answer: str
    explanation: str
    difficulty: int
    domain_id: str
    points: int = 1

@dataclass
class UserAnswer:
    """用戶答案"""
    question_id: str
    user_answer: str
    is_correct: bool
    time_spent_seconds: int
    answered_at: datetime

@dataclass
class ExamSession:
    """考試會話"""
    session_id: str
    user_id: str
    cert_id: str
    config: ExamConfig
    questions: List[ExamQuestion] = field(default_factory=list)
    answers: List[UserAnswer] = field(default_factory=list)
    status: ExamStatus = ExamStatus.NOT_STARTED
    started_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None
    current_index: int = 0

# ============================================================
# 題目抽取策略
# ============================================================

class QuestionSelector:
    """題目抽取器"""
    
    # 認證考試配置
    EXAM_CONFIGS = {
        'CERT001': ExamConfig(
            cert_id='CERT001',
            exam_name='Google AI Essentials 模擬考',
            total_questions=50,
            time_limit_minutes=60,
            passing_score=70,
            question_distribution={'single': 35, 'multi': 10, 'scenario': 5}
        ),
        'CERT002': ExamConfig(
            cert_id='CERT002',
            exam_name='AWS AI Practitioner 模擬考',
            total_questions=65,
            time_limit_minutes=90,
            passing_score=70,
            question_distribution={'single': 45, 'multi': 15, 'case_study': 5}
        ),
        'CERT003': ExamConfig(
            cert_id='CERT003',
            exam_name='Microsoft AI-900 模擬考',
            total_questions=50,
            time_limit_minutes=60,
            passing_score=70,
            question_distribution={'single': 35, 'multi': 10, 'matching': 5}
        ),
        'IPAS_ISE': ExamConfig(
            cert_id='IPAS_ISE',
            exam_name='IPAS 資安工程師 模擬考',
            total_questions=80,
            time_limit_minutes=100,
            passing_score=60,
            question_distribution={'single': 80}
        )
    }
    
    def __init__(self, db_path: str):
        self.db_path = db_path
    
    def get_config(self, cert_id: str) -> ExamConfig:
        """獲取考試配置"""
        return self.EXAM_CONFIGS.get(cert_id, ExamConfig(
            cert_id=cert_id,
            exam_name=f'{cert_id} 模擬考',
            total_questions=50,
            time_limit_minutes=60,
            passing_score=70
        ))
    
    def select_questions(self, cert_id: str, count: Optional[int] = None,
                        difficulty_range: Tuple[int, int] = (1, 5)) -> List[ExamQuestion]:
        """抽取題目"""
        config = self.get_config(cert_id)
        total = count or config.total_questions
        
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        questions = []
        
        # 判斷題庫來源
        if cert_id.startswith('IPAS'):
            questions = self._select_ipas(cur, total, difficulty_range)
        else:
            questions = self._select_ai_cert(cur, cert_id, total, config, difficulty_range)
        
        conn.close()
        
        # 打亂順序
        random.shuffle(questions)
        return questions
    
    def _select_ai_cert(self, cur, cert_id: str, total: int, 
                       config: ExamConfig, diff_range: Tuple[int, int]) -> List[ExamQuestion]:
        """抽取 AI 認證題目"""
        questions = []
        distribution = config.question_distribution
        
        for q_type, count in distribution.items():
            cur.execute('''
                SELECT question_id, question_type, question_text, options, answer, 
                       explanation, difficulty, domain_id
                FROM ai_cert_questions_v2
                WHERE cert_id = ? AND question_type = ?
                AND difficulty BETWEEN ? AND ?
                ORDER BY RANDOM()
                LIMIT ?
            ''', (cert_id, q_type, diff_range[0], diff_range[1], count))
            
            for row in cur.fetchall():
                questions.append(ExamQuestion(
                    question_id=row[0],
                    question_type=QuestionType(row[1]) if row[1] else QuestionType.SINGLE,
                    question_text=row[2],
                    options=json.loads(row[3]) if row[3] else [],
                    correct_answer=row[4] or '',
                    explanation=row[5] or '',
                    difficulty=row[6] or 3,
                    domain_id=row[7] or ''
                ))
        
        # 如果不夠，補充單選題
        if len(questions) < total:
            remaining = total - len(questions)
            existing_ids = [q.question_id for q in questions]
            
            cur.execute(f'''
                SELECT question_id, question_type, question_text, options, answer,
                       explanation, difficulty, domain_id
                FROM ai_cert_questions_v2
                WHERE cert_id = ? AND question_id NOT IN ({','.join(['?']*len(existing_ids))})
                ORDER BY RANDOM()
                LIMIT ?
            ''', (cert_id, *existing_ids, remaining))
            
            for row in cur.fetchall():
                questions.append(ExamQuestion(
                    question_id=row[0],
                    question_type=QuestionType(row[1]) if row[1] else QuestionType.SINGLE,
                    question_text=row[2],
                    options=json.loads(row[3]) if row[3] else [],
                    correct_answer=row[4] or '',
                    explanation=row[5] or '',
                    difficulty=row[6] or 3,
                    domain_id=row[7] or ''
                ))
        
        return questions[:total]
    
    def _select_ipas(self, cur, total: int, diff_range: Tuple[int, int]) -> List[ExamQuestion]:
        """抽取 IPAS 題目"""
        cur.execute('''
            SELECT question_id, question_type, question_text, options, answer,
                   explanation, difficulty, domain_id
            FROM ipas_ise_questions
            WHERE difficulty BETWEEN ? AND ?
            ORDER BY RANDOM()
            LIMIT ?
        ''', (diff_range[0], diff_range[1], total))
        
        questions = []
        for row in cur.fetchall():
            questions.append(ExamQuestion(
                question_id=row[0],
                question_type=QuestionType.SINGLE,
                question_text=row[2],
                options=json.loads(row[3]) if row[3] else [],
                correct_answer=row[4] or '',
                explanation=row[5] or '',
                difficulty=row[6] or 3,
                domain_id=row[7] or ''
            ))
        
        return questions

# ============================================================
# 計時器
# ============================================================

class ExamTimer:
    """考試計時器"""
    
    def __init__(self, time_limit_minutes: int):
        self.time_limit = time_limit_minutes * 60  # 轉換為秒
        self.start_time: Optional[float] = None
        self.pause_time: Optional[float] = None
        self.total_paused: float = 0
    
    def start(self):
        """開始計時"""
        self.start_time = time.time()
    
    def pause(self):
        """暫停"""
        if self.start_time and not self.pause_time:
            self.pause_time = time.time()
    
    def resume(self):
        """繼續"""
        if self.pause_time:
            self.total_paused += time.time() - self.pause_time
            self.pause_time = None
    
    def get_elapsed(self) -> int:
        """已用時間（秒）"""
        if not self.start_time:
            return 0
        
        current = self.pause_time or time.time()
        return int(current - self.start_time - self.total_paused)
    
    def get_remaining(self) -> int:
        """剩餘時間（秒）"""
        return max(0, self.time_limit - self.get_elapsed())
    
    def is_timeout(self) -> bool:
        """是否超時"""
        return self.get_remaining() <= 0
    
    def format_remaining(self) -> str:
        """格式化剩餘時間"""
        remaining = self.get_remaining()
        minutes = remaining // 60
        seconds = remaining % 60
        return f"{minutes:02d}:{seconds:02d}"

# ============================================================
# 即時評分系統
# ============================================================

class ExamScorer:
    """即時評分系統"""
    
    def __init__(self):
        self.correct_count = 0
        self.total_answered = 0
        self.domain_scores: Dict[str, Dict] = {}
    
    def score_answer(self, question: ExamQuestion, user_answer: str) -> Tuple[bool, int]:
        """評分單題"""
        is_correct = self._check_answer(question, user_answer)
        points = question.points if is_correct else 0
        
        self.total_answered += 1
        if is_correct:
            self.correct_count += 1
        
        # 領域統計
        domain = question.domain_id
        if domain not in self.domain_scores:
            self.domain_scores[domain] = {'correct': 0, 'total': 0}
        self.domain_scores[domain]['total'] += 1
        if is_correct:
            self.domain_scores[domain]['correct'] += 1
        
        return is_correct, points
    
    def _check_answer(self, question: ExamQuestion, user_answer: str) -> bool:
        """檢查答案"""
        correct = question.correct_answer
        
        # 多選題：比較集合
        if question.question_type == QuestionType.MULTI:
            try:
                user_set = set(json.loads(user_answer)) if isinstance(user_answer, str) else set(user_answer)
                correct_set = set(json.loads(correct)) if isinstance(correct, str) else set(correct)
                return user_set == correct_set
            except:
                return user_answer == correct
        
        # 配對題/排序題
        if question.question_type in [QuestionType.MATCHING, QuestionType.ORDERING]:
            try:
                user_list = json.loads(user_answer) if isinstance(user_answer, str) else user_answer
                correct_list = json.loads(correct) if isinstance(correct, str) else correct
                return user_list == correct_list
            except:
                return user_answer == correct
        
        # 單選題
        return str(user_answer).strip().upper() == str(correct).strip().upper()
    
    def get_current_score(self) -> float:
        """當前分數"""
        if self.total_answered == 0:
            return 0
        return round(self.correct_count / self.total_answered * 100, 1)
    
    def get_domain_breakdown(self) -> List[Dict]:
        """領域分數細分"""
        breakdown = []
        for domain, stats in self.domain_scores.items():
            accuracy = stats['correct'] / max(stats['total'], 1) * 100
            breakdown.append({
                'domain_id': domain,
                'correct': stats['correct'],
                'total': stats['total'],
                'accuracy': round(accuracy, 1)
            })
        return sorted(breakdown, key=lambda x: x['accuracy'])

# ============================================================
# 考試報告生成
# ============================================================

class ExamReportGenerator:
    """考試報告生成器"""
    
    def generate_report(self, session: ExamSession, scorer: ExamScorer, 
                       timer: ExamTimer) -> Dict:
        """生成完整考試報告"""
        config = session.config
        total_questions = len(session.questions)
        answered = len(session.answers)
        
        # 基本統計
        score = scorer.get_current_score()
        passed = score >= config.passing_score
        
        # 時間分析
        total_time = timer.get_elapsed()
        avg_time = total_time / max(answered, 1)
        
        # 領域分析
        domain_breakdown = scorer.get_domain_breakdown()
        
        # 弱點識別
        weak_domains = [d for d in domain_breakdown if d['accuracy'] < 60]
        
        # 題型分析
        type_stats = self._analyze_by_type(session, scorer)
        
        # 難度分析
        difficulty_stats = self._analyze_by_difficulty(session)
        
        return {
            'session_id': session.session_id,
            'user_id': session.user_id,
            'cert_id': session.cert_id,
            'exam_name': config.exam_name,
            'completed_at': datetime.now().isoformat(),
            
            'summary': {
                'total_questions': total_questions,
                'answered': answered,
                'correct': scorer.correct_count,
                'score': score,
                'passing_score': config.passing_score,
                'passed': passed,
                'time_spent_minutes': round(total_time / 60, 1),
                'avg_time_per_question': round(avg_time, 1)
            },
            
            'domain_analysis': domain_breakdown,
            'weak_domains': weak_domains,
            'type_analysis': type_stats,
            'difficulty_analysis': difficulty_stats,
            
            'recommendations': self._generate_recommendations(
                score, passed, weak_domains, difficulty_stats
            )
        }
    
    def _analyze_by_type(self, session: ExamSession, scorer: ExamScorer) -> List[Dict]:
        """按題型分析"""
        type_stats = {}
        
        for i, q in enumerate(session.questions):
            if i >= len(session.answers):
                break
            
            q_type = q.question_type.value
            if q_type not in type_stats:
                type_stats[q_type] = {'correct': 0, 'total': 0}
            
            type_stats[q_type]['total'] += 1
            if session.answers[i].is_correct:
                type_stats[q_type]['correct'] += 1
        
        return [
            {
                'type': t,
                'correct': s['correct'],
                'total': s['total'],
                'accuracy': round(s['correct'] / max(s['total'], 1) * 100, 1)
            }
            for t, s in type_stats.items()
        ]
    
    def _analyze_by_difficulty(self, session: ExamSession) -> Dict:
        """按難度分析"""
        diff_stats = {1: {'c': 0, 't': 0}, 2: {'c': 0, 't': 0}, 
                     3: {'c': 0, 't': 0}, 4: {'c': 0, 't': 0}, 5: {'c': 0, 't': 0}}
        
        for i, q in enumerate(session.questions):
            if i >= len(session.answers):
                break
            
            diff = min(max(q.difficulty, 1), 5)
            diff_stats[diff]['t'] += 1
            if session.answers[i].is_correct:
                diff_stats[diff]['c'] += 1
        
        return {
            f'level_{d}': {
                'correct': s['c'],
                'total': s['t'],
                'accuracy': round(s['c'] / max(s['t'], 1) * 100, 1)
            }
            for d, s in diff_stats.items() if s['t'] > 0
        }
    
    def _generate_recommendations(self, score: float, passed: bool,
                                 weak_domains: List, diff_stats: Dict) -> List[str]:
        """生成建議"""
        recommendations = []
        
        if not passed:
            recommendations.append(f"未達及格標準，建議加強練習後再次挑戰")
        
        if weak_domains:
            domains = ', '.join([d['domain_id'] for d in weak_domains[:3]])
            recommendations.append(f"弱點領域：{domains}，建議重點複習")
        
        # 難度建議
        easy_acc = diff_stats.get('level_1', {}).get('accuracy', 100)
        hard_acc = diff_stats.get('level_5', {}).get('accuracy', 100)
        
        if easy_acc < 80:
            recommendations.append("基礎題正確率偏低，建議鞏固基本概念")
        if hard_acc > 80:
            recommendations.append("進階題表現優秀，可挑戰更高難度")
        
        if passed and score >= 90:
            recommendations.append("表現優異！可以報名正式考試")
        
        return recommendations

# ============================================================
# 模擬考主引擎
# ============================================================

class CertExamSimulator:
    """認證模擬考主引擎"""
    
    def __init__(self, db_path: str):
        self.db_path = db_path
        self.selector = QuestionSelector(db_path)
        self.sessions: Dict[str, ExamSession] = {}
        self.timers: Dict[str, ExamTimer] = {}
        self.scorers: Dict[str, ExamScorer] = {}
    
    def create_exam(self, user_id: str, cert_id: str, 
                   question_count: Optional[int] = None) -> Dict:
        """創建考試"""
        import uuid
        session_id = str(uuid.uuid4())[:8]
        
        config = self.selector.get_config(cert_id)
        questions = self.selector.select_questions(cert_id, question_count)
        
        session = ExamSession(
            session_id=session_id,
            user_id=user_id,
            cert_id=cert_id,
            config=config,
            questions=questions
        )
        
        self.sessions[session_id] = session
        self.timers[session_id] = ExamTimer(config.time_limit_minutes)
        self.scorers[session_id] = ExamScorer()
        
        return {
            'session_id': session_id,
            'exam_name': config.exam_name,
            'total_questions': len(questions),
            'time_limit_minutes': config.time_limit_minutes,
            'passing_score': config.passing_score,
            'message': '考試已創建，呼叫 start_exam 開始'
        }
    
    def start_exam(self, session_id: str) -> Dict:
        """開始考試"""
        session = self.sessions.get(session_id)
        if not session:
            return {'error': '找不到考試'}
        
        session.status = ExamStatus.IN_PROGRESS
        session.started_at = datetime.now()
        self.timers[session_id].start()
        
        return {
            'session_id': session_id,
            'status': 'started',
            'first_question': self._format_question(session.questions[0], 0),
            'time_remaining': self.timers[session_id].format_remaining()
        }
    
    def submit_answer(self, session_id: str, user_answer: str) -> Dict:
        """提交答案"""
        session = self.sessions.get(session_id)
        timer = self.timers.get(session_id)
        scorer = self.scorers.get(session_id)
        
        if not session or session.status != ExamStatus.IN_PROGRESS:
            return {'error': '考試未進行中'}
        
        # 檢查超時
        if timer.is_timeout():
            return self.end_exam(session_id, timeout=True)
        
        # 獲取當前題目
        current_q = session.questions[session.current_index]
        
        # 評分
        is_correct, points = scorer.score_answer(current_q, user_answer)
        
        # 記錄答案
        answer = UserAnswer(
            question_id=current_q.question_id,
            user_answer=user_answer,
            is_correct=is_correct,
            time_spent_seconds=0,
            answered_at=datetime.now()
        )
        session.answers.append(answer)
        
        # 下一題
        session.current_index += 1
        
        # 檢查是否完成
        if session.current_index >= len(session.questions):
            return self.end_exam(session_id)
        
        return {
            'is_correct': is_correct,
            'correct_answer': current_q.correct_answer,
            'explanation': current_q.explanation,
            'current_score': scorer.get_current_score(),
            'progress': f"{session.current_index}/{len(session.questions)}",
            'time_remaining': timer.format_remaining(),
            'next_question': self._format_question(
                session.questions[session.current_index], 
                session.current_index
            )
        }
    
    def end_exam(self, session_id: str, timeout: bool = False) -> Dict:
        """結束考試"""
        session = self.sessions.get(session_id)
        timer = self.timers.get(session_id)
        scorer = self.scorers.get(session_id)
        
        if not session:
            return {'error': '找不到考試'}
        
        session.status = ExamStatus.TIMEOUT if timeout else ExamStatus.COMPLETED
        session.ended_at = datetime.now()
        
        # 生成報告
        reporter = ExamReportGenerator()
        report = reporter.generate_report(session, scorer, timer)
        
        return {
            'status': session.status.value,
            'report': report
        }
    
    def _format_question(self, q: ExamQuestion, index: int) -> Dict:
        """格式化題目（不含答案）"""
        return {
            'index': index + 1,
            'question_id': q.question_id,
            'type': q.question_type.value,
            'text': q.question_text,
            'options': q.options,
            'difficulty': q.difficulty,
            'domain_id': q.domain_id
        }
    
    def get_exam_status(self, session_id: str) -> Dict:
        """獲取考試狀態"""
        session = self.sessions.get(session_id)
        timer = self.timers.get(session_id)
        scorer = self.scorers.get(session_id)
        
        if not session:
            return {'error': '找不到考試'}
        
        return {
            'session_id': session_id,
            'status': session.status.value,
            'progress': f"{session.current_index}/{len(session.questions)}",
            'answered': len(session.answers),
            'current_score': scorer.get_current_score() if scorer else 0,
            'time_remaining': timer.format_remaining() if timer else '00:00'
        }

# ============================================================
# 測試
# ============================================================

if __name__ == "__main__":
    print("=" * 50)
    print("認證模擬考系統 R10 測試")
    print("=" * 50)
    
    simulator = CertExamSimulator('/home/claude/v51_work/education_v51.db')
    
    # 測試創建考試
    exam = simulator.create_exam('test_user', 'CERT001', 5)
    print(f"\n創建考試: {exam['exam_name']}")
    print(f"題數: {exam['total_questions']}")
    print(f"時限: {exam['time_limit_minutes']} 分鐘")
    
    # 測試開始
    start = simulator.start_exam(exam['session_id'])
    print(f"\n開始考試，第一題:")
    print(f"  {start['first_question']['text'][:50]}...")
    
    print("\n✅ R10 認證模擬考系統完成")
