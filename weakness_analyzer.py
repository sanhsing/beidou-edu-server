"""
弱點深度分析引擎
理科線產出 R16

功能：
1. 多維度弱點識別
2. 根因分析
3. 強化學習建議
"""

import sqlite3
import json
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, field
from collections import defaultdict
from enum import Enum

class WeaknessType(Enum):
    """弱點類型"""
    CONCEPT = 'concept'           # 概念理解弱
    APPLICATION = 'application'   # 應用能力弱
    SPEED = 'speed'               # 答題速度慢
    CARELESS = 'careless'         # 粗心錯誤
    PATTERN = 'pattern'           # 特定題型弱
    DOMAIN = 'domain'             # 特定領域弱

@dataclass
class WeaknessReport:
    """弱點報告"""
    user_id: str
    cert_id: str
    generated_at: datetime
    
    # 整體分析
    overall_accuracy: float = 0.0
    total_questions: int = 0
    
    # 多維弱點
    weak_domains: List[Dict] = field(default_factory=list)
    weak_concepts: List[Dict] = field(default_factory=list)
    weak_patterns: List[Dict] = field(default_factory=list)
    
    # 行為分析
    speed_issues: List[Dict] = field(default_factory=list)
    careless_errors: int = 0
    
    # 建議
    recommendations: List[str] = field(default_factory=list)
    priority_topics: List[str] = field(default_factory=list)

class WeaknessAnalyzer:
    """弱點深度分析引擎"""
    
    # 閾值
    WEAK_THRESHOLD = 0.6        # 正確率低於此值視為弱點
    STRONG_THRESHOLD = 0.85     # 正確率高於此值視為強項
    MIN_ATTEMPTS = 3            # 最少嘗試次數才計入分析
    SPEED_THRESHOLD = 120       # 答題超過120秒視為慢
    
    def __init__(self, db_path: str):
        self.db_path = db_path
        self._ensure_tables()
    
    def _ensure_tables(self):
        """確保分析表存在"""
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        cur.execute('''
            CREATE TABLE IF NOT EXISTS weakness_analysis (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT,
                cert_id TEXT,
                analysis_type TEXT,
                target_id TEXT,
                accuracy REAL,
                attempts INTEGER,
                avg_time REAL,
                details TEXT,
                analyzed_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        cur.execute('''
            CREATE TABLE IF NOT EXISTS weakness_reports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id TEXT,
                cert_id TEXT,
                report_json TEXT,
                generated_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        cur.execute('CREATE INDEX IF NOT EXISTS idx_wa_user ON weakness_analysis(user_id, cert_id)')
        
        conn.commit()
        conn.close()
    
    def analyze_user(self, user_id: str, cert_id: str) -> WeaknessReport:
        """分析用戶弱點"""
        report = WeaknessReport(
            user_id=user_id,
            cert_id=cert_id,
            generated_at=datetime.now()
        )
        
        # 1. 獲取答題記錄
        records = self._get_answer_records(user_id, cert_id)
        if not records:
            return report
        
        report.total_questions = len(records)
        report.overall_accuracy = sum(1 for r in records if r['correct']) / len(records)
        
        # 2. 領域分析
        report.weak_domains = self._analyze_by_domain(records)
        
        # 3. 概念分析（基於標籤）
        report.weak_concepts = self._analyze_by_tags(records)
        
        # 4. 題型分析
        report.weak_patterns = self._analyze_by_type(records)
        
        # 5. 速度分析
        report.speed_issues = self._analyze_speed(records)
        
        # 6. 粗心分析
        report.careless_errors = self._count_careless(records)
        
        # 7. 生成建議
        report.recommendations = self._generate_recommendations(report)
        report.priority_topics = self._get_priority_topics(report)
        
        # 保存報告
        self._save_report(report)
        
        return report
    
    def _get_answer_records(self, user_id: str, cert_id: str) -> List[Dict]:
        """獲取答題記錄"""
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        # 從自適應學習日誌獲取
        cur.execute('''
            SELECT question_id, is_correct, response_time, domain_id, difficulty
            FROM adaptive_learning_log
            WHERE user_id = ? AND cert_id = ?
            ORDER BY created_at DESC
            LIMIT 500
        ''', (user_id, cert_id))
        
        records = []
        for row in cur.fetchall():
            # 獲取題目詳情
            cur.execute('''
                SELECT question_type, tags, domain_id
                FROM ai_cert_questions_v2
                WHERE question_id = ?
            ''', (row[0],))
            
            q_info = cur.fetchone()
            
            records.append({
                'question_id': row[0],
                'correct': bool(row[1]),
                'time': row[2] or 60,
                'domain_id': row[3] or (q_info[2] if q_info else ''),
                'difficulty': row[4] or 3,
                'question_type': q_info[0] if q_info else 'single',
                'tags': json.loads(q_info[1]) if q_info and q_info[1] else []
            })
        
        conn.close()
        return records
    
    def _analyze_by_domain(self, records: List[Dict]) -> List[Dict]:
        """按領域分析弱點"""
        domain_stats = defaultdict(lambda: {'correct': 0, 'total': 0, 'times': []})
        
        for r in records:
            domain = r['domain_id'] or 'unknown'
            domain_stats[domain]['total'] += 1
            if r['correct']:
                domain_stats[domain]['correct'] += 1
            domain_stats[domain]['times'].append(r['time'])
        
        weak_domains = []
        for domain, stats in domain_stats.items():
            if stats['total'] >= self.MIN_ATTEMPTS:
                accuracy = stats['correct'] / stats['total']
                if accuracy < self.WEAK_THRESHOLD:
                    weak_domains.append({
                        'domain_id': domain,
                        'accuracy': round(accuracy * 100, 1),
                        'attempts': stats['total'],
                        'avg_time': round(sum(stats['times']) / len(stats['times']), 1),
                        'severity': 'high' if accuracy < 0.4 else 'medium'
                    })
        
        return sorted(weak_domains, key=lambda x: x['accuracy'])
    
    def _analyze_by_tags(self, records: List[Dict]) -> List[Dict]:
        """按標籤/概念分析弱點"""
        tag_stats = defaultdict(lambda: {'correct': 0, 'total': 0})
        
        for r in records:
            for tag in r.get('tags', []):
                tag_stats[tag]['total'] += 1
                if r['correct']:
                    tag_stats[tag]['correct'] += 1
        
        weak_concepts = []
        for tag, stats in tag_stats.items():
            if stats['total'] >= self.MIN_ATTEMPTS:
                accuracy = stats['correct'] / stats['total']
                if accuracy < self.WEAK_THRESHOLD:
                    weak_concepts.append({
                        'concept': tag,
                        'accuracy': round(accuracy * 100, 1),
                        'attempts': stats['total'],
                        'severity': 'high' if accuracy < 0.4 else 'medium'
                    })
        
        return sorted(weak_concepts, key=lambda x: x['accuracy'])[:10]
    
    def _analyze_by_type(self, records: List[Dict]) -> List[Dict]:
        """按題型分析弱點"""
        type_stats = defaultdict(lambda: {'correct': 0, 'total': 0})
        
        for r in records:
            q_type = r.get('question_type', 'single')
            type_stats[q_type]['total'] += 1
            if r['correct']:
                type_stats[q_type]['correct'] += 1
        
        weak_patterns = []
        for q_type, stats in type_stats.items():
            if stats['total'] >= self.MIN_ATTEMPTS:
                accuracy = stats['correct'] / stats['total']
                if accuracy < self.WEAK_THRESHOLD:
                    weak_patterns.append({
                        'question_type': q_type,
                        'accuracy': round(accuracy * 100, 1),
                        'attempts': stats['total']
                    })
        
        return sorted(weak_patterns, key=lambda x: x['accuracy'])
    
    def _analyze_speed(self, records: List[Dict]) -> List[Dict]:
        """分析答題速度問題"""
        slow_domains = defaultdict(lambda: {'slow_count': 0, 'total': 0})
        
        for r in records:
            domain = r['domain_id'] or 'unknown'
            slow_domains[domain]['total'] += 1
            if r['time'] > self.SPEED_THRESHOLD:
                slow_domains[domain]['slow_count'] += 1
        
        speed_issues = []
        for domain, stats in slow_domains.items():
            if stats['total'] >= self.MIN_ATTEMPTS:
                slow_rate = stats['slow_count'] / stats['total']
                if slow_rate > 0.3:  # 超過30%的題目慢
                    speed_issues.append({
                        'domain_id': domain,
                        'slow_rate': round(slow_rate * 100, 1),
                        'total': stats['total']
                    })
        
        return speed_issues
    
    def _count_careless(self, records: List[Dict]) -> int:
        """統計粗心錯誤"""
        # 簡單題目答錯視為粗心
        careless = 0
        for r in records:
            if not r['correct'] and r['difficulty'] <= 2:
                careless += 1
        return careless
    
    def _generate_recommendations(self, report: WeaknessReport) -> List[str]:
        """生成改進建議"""
        recommendations = []
        
        # 基於弱點領域
        if report.weak_domains:
            top_weak = report.weak_domains[0]
            recommendations.append(
                f"優先加強 {top_weak['domain_id']} 領域，"
                f"目前正確率僅 {top_weak['accuracy']}%"
            )
        
        # 基於弱點概念
        if report.weak_concepts:
            concepts = ', '.join([c['concept'] for c in report.weak_concepts[:3]])
            recommendations.append(f"重點複習概念：{concepts}")
        
        # 基於題型
        if report.weak_patterns:
            for pattern in report.weak_patterns:
                if pattern['question_type'] == 'multi':
                    recommendations.append("多選題正確率低，注意仔細閱讀所有選項")
                elif pattern['question_type'] == 'scenario':
                    recommendations.append("情境題需要加強，練習分析案例的能力")
        
        # 基於速度
        if report.speed_issues:
            recommendations.append("部分領域答題較慢，建議增加練習提升熟練度")
        
        # 基於粗心
        if report.careless_errors > 5:
            recommendations.append("簡單題有較多錯誤，建議放慢速度仔細審題")
        
        # 整體建議
        if report.overall_accuracy < 0.5:
            recommendations.append("建議從基礎概念開始重新學習")
        elif report.overall_accuracy < 0.7:
            recommendations.append("距離及格還需努力，每天堅持練習")
        elif report.overall_accuracy >= 0.8:
            recommendations.append("表現不錯！可以挑戰更高難度的題目")
        
        return recommendations
    
    def _get_priority_topics(self, report: WeaknessReport) -> List[str]:
        """獲取優先學習主題"""
        priorities = []
        
        # 從弱點領域
        for d in report.weak_domains[:3]:
            priorities.append(d['domain_id'])
        
        # 從弱點概念
        for c in report.weak_concepts[:5]:
            if c['concept'] not in priorities:
                priorities.append(c['concept'])
        
        return priorities[:7]
    
    def _save_report(self, report: WeaknessReport):
        """保存報告"""
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        report_json = json.dumps({
            'overall_accuracy': report.overall_accuracy,
            'total_questions': report.total_questions,
            'weak_domains': report.weak_domains,
            'weak_concepts': report.weak_concepts,
            'weak_patterns': report.weak_patterns,
            'speed_issues': report.speed_issues,
            'careless_errors': report.careless_errors,
            'recommendations': report.recommendations,
            'priority_topics': report.priority_topics
        }, ensure_ascii=False)
        
        cur.execute('''
            INSERT INTO weakness_reports (user_id, cert_id, report_json, generated_at)
            VALUES (?, ?, ?, ?)
        ''', (report.user_id, report.cert_id, report_json, 
              report.generated_at.isoformat()))
        
        conn.commit()
        conn.close()
    
    def get_improvement_plan(self, user_id: str, cert_id: str,
                            days: int = 7) -> Dict:
        """生成改進計畫"""
        report = self.analyze_user(user_id, cert_id)
        
        daily_plan = []
        topics = report.priority_topics.copy()
        
        for day in range(1, days + 1):
            if topics:
                focus = topics.pop(0)
            else:
                focus = "綜合複習"
            
            daily_plan.append({
                'day': day,
                'date': (datetime.now() + timedelta(days=day-1)).strftime('%m/%d'),
                'focus': focus,
                'tasks': [
                    f"複習 {focus} 相關概念",
                    f"完成 10 題 {focus} 練習",
                    "回顧今日錯題"
                ]
            })
        
        return {
            'user_id': user_id,
            'cert_id': cert_id,
            'current_accuracy': round(report.overall_accuracy * 100, 1),
            'target_accuracy': 80,
            'duration_days': days,
            'daily_plan': daily_plan,
            'key_weaknesses': report.weak_domains[:3],
            'recommendations': report.recommendations
        }

# ============================================================
# 測試
# ============================================================

if __name__ == "__main__":
    print("=" * 55)
    print("弱點深度分析引擎 R16 測試")
    print("=" * 55)
    
    analyzer = WeaknessAnalyzer('/home/claude/education_v53.db')
    
    # 模擬分析（需要有答題記錄）
    user_id = 'test_weakness'
    cert_id = 'CERT001'
    
    report = analyzer.analyze_user(user_id, cert_id)
    
    print(f"\n弱點分析報告:")
    print(f"  用戶: {report.user_id}")
    print(f"  認證: {report.cert_id}")
    print(f"  整體正確率: {report.overall_accuracy*100:.1f}%")
    print(f"  弱點領域: {len(report.weak_domains)} 個")
    print(f"  弱點概念: {len(report.weak_concepts)} 個")
    
    if report.recommendations:
        print(f"\n建議:")
        for r in report.recommendations[:3]:
            print(f"  • {r}")
    
    # 生成改進計畫
    plan = analyzer.get_improvement_plan(user_id, cert_id, 7)
    print(f"\n7日改進計畫:")
    for day in plan['daily_plan'][:3]:
        print(f"  Day {day['day']} ({day['date']}): {day['focus']}")
    
    print("\n✅ R16 弱點深度分析引擎完成")
