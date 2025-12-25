"""
學習報告生成器
理科線產出 R19

功能：
1. 每日學習報告
2. 每週學習總結
3. 認證準備度報告
4. 學習趨勢分析
"""

import sqlite3
import json
from datetime import datetime, timedelta
from typing import Dict, List, Optional
from dataclasses import dataclass, field
from collections import defaultdict

@dataclass
class DailyReport:
    """每日報告"""
    user_id: str
    date: str
    
    # 學習數據
    questions_attempted: int = 0
    correct_count: int = 0
    accuracy: float = 0.0
    time_spent_minutes: int = 0
    
    # 領域表現
    domain_stats: Dict = field(default_factory=dict)
    
    # 錯題
    new_wrong: int = 0
    reviewed_wrong: int = 0
    
    # 比較
    vs_yesterday: float = 0.0
    vs_week_avg: float = 0.0
    
    # 建議
    focus_areas: List[str] = field(default_factory=list)
    encouragement: str = ""

@dataclass
class WeeklyReport:
    """每週報告"""
    user_id: str
    week_start: str
    week_end: str
    
    # 總體數據
    total_questions: int = 0
    total_correct: int = 0
    total_time_minutes: int = 0
    study_days: int = 0
    
    # 進步
    accuracy_trend: List[float] = field(default_factory=list)
    improvement: float = 0.0
    
    # 里程碑
    milestones: List[str] = field(default_factory=list)
    
    # 弱點與強項
    weak_areas: List[Dict] = field(default_factory=list)
    strong_areas: List[Dict] = field(default_factory=list)
    
    # 下週目標
    next_week_goals: List[str] = field(default_factory=list)

@dataclass
class ReadinessReport:
    """認證準備度報告"""
    user_id: str
    cert_id: str
    generated_at: str
    
    # 準備度評分
    overall_readiness: float = 0.0
    readiness_level: str = ""  # NOT_READY, ALMOST, READY, EXCELLENT
    
    # 領域覆蓋
    domain_coverage: Dict = field(default_factory=dict)
    uncovered_domains: List[str] = field(default_factory=list)
    
    # 預測
    predicted_score: int = 0
    pass_probability: float = 0.0
    
    # 建議
    days_to_ready: int = 0
    action_plan: List[str] = field(default_factory=list)

class LearningReportGenerator:
    """學習報告生成器"""
    
    # 激勵語
    ENCOURAGEMENTS = {
        'excellent': [
            "太棒了！你的表現超越了 90% 的學習者！",
            "持續保持這個節奏，成功就在眼前！",
            "你的努力正在轉化為實力！"
        ],
        'good': [
            "做得好！保持這個學習動力！",
            "穩步前進，你正在進步！",
            "每天都在變得更強！"
        ],
        'average': [
            "堅持就是勝利，繼續加油！",
            "今天的努力是明天的基礎！",
            "不積跬步無以至千里，繼續！"
        ],
        'needs_work': [
            "不要氣餒，每個專家都曾是初學者！",
            "困難是成長的機會，堅持下去！",
            "調整策略，相信自己能做到！"
        ]
    }
    
    def __init__(self, db_path: str):
        self.db_path = db_path
    
    def generate_daily_report(self, user_id: str, 
                             date: str = None) -> DailyReport:
        """生成每日報告"""
        if not date:
            date = datetime.now().strftime('%Y-%m-%d')
        
        report = DailyReport(user_id=user_id, date=date)
        
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        # 獲取今日學習數據
        cur.execute('''
            SELECT COUNT(*), SUM(is_correct), SUM(response_time)
            FROM adaptive_learning_log
            WHERE user_id = ? AND DATE(created_at) = ?
        ''', (user_id, date))
        
        row = cur.fetchone()
        if row and row[0]:
            report.questions_attempted = row[0]
            report.correct_count = row[1] or 0
            report.accuracy = round(report.correct_count / row[0] * 100, 1)
            report.time_spent_minutes = int((row[2] or 0) / 60)
        
        # 領域表現
        cur.execute('''
            SELECT domain_id, COUNT(*), SUM(is_correct)
            FROM adaptive_learning_log
            WHERE user_id = ? AND DATE(created_at) = ?
            GROUP BY domain_id
        ''', (user_id, date))
        
        for row in cur.fetchall():
            if row[0]:
                acc = round(row[2] / row[1] * 100, 1) if row[1] else 0
                report.domain_stats[row[0]] = {
                    'attempted': row[1],
                    'correct': row[2],
                    'accuracy': acc
                }
        
        # 錯題統計
        cur.execute('''
            SELECT COUNT(*) FROM wrong_notebook
            WHERE user_id = ? AND DATE(last_wrong) = ?
        ''', (user_id, date))
        report.new_wrong = cur.fetchone()[0] or 0
        
        cur.execute('''
            SELECT COUNT(*) FROM wrong_review_history
            WHERE user_id = ? AND DATE(reviewed_at) = ?
        ''', (user_id, date))
        report.reviewed_wrong = cur.fetchone()[0] or 0
        
        # 昨日比較
        yesterday = (datetime.strptime(date, '%Y-%m-%d') - timedelta(days=1)).strftime('%Y-%m-%d')
        cur.execute('''
            SELECT COUNT(*), SUM(is_correct)
            FROM adaptive_learning_log
            WHERE user_id = ? AND DATE(created_at) = ?
        ''', (user_id, yesterday))
        
        row = cur.fetchone()
        if row and row[0] and row[0] > 0:
            yesterday_acc = row[1] / row[0] * 100
            report.vs_yesterday = round(report.accuracy - yesterday_acc, 1)
        
        # 週平均比較
        week_ago = (datetime.strptime(date, '%Y-%m-%d') - timedelta(days=7)).strftime('%Y-%m-%d')
        cur.execute('''
            SELECT COUNT(*), SUM(is_correct)
            FROM adaptive_learning_log
            WHERE user_id = ? AND DATE(created_at) BETWEEN ? AND ?
        ''', (user_id, week_ago, date))
        
        row = cur.fetchone()
        if row and row[0] and row[0] > 0:
            week_avg = row[1] / row[0] * 100
            report.vs_week_avg = round(report.accuracy - week_avg, 1)
        
        conn.close()
        
        # 生成建議和激勵
        report.focus_areas = self._get_focus_areas(report.domain_stats)
        report.encouragement = self._get_encouragement(report.accuracy)
        
        return report
    
    def generate_weekly_report(self, user_id: str,
                              week_end: str = None) -> WeeklyReport:
        """生成每週報告"""
        if not week_end:
            week_end = datetime.now().strftime('%Y-%m-%d')
        
        end_date = datetime.strptime(week_end, '%Y-%m-%d')
        start_date = end_date - timedelta(days=6)
        week_start = start_date.strftime('%Y-%m-%d')
        
        report = WeeklyReport(
            user_id=user_id,
            week_start=week_start,
            week_end=week_end
        )
        
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        # 總體數據
        cur.execute('''
            SELECT COUNT(*), SUM(is_correct), SUM(response_time),
                   COUNT(DISTINCT DATE(created_at))
            FROM adaptive_learning_log
            WHERE user_id = ? AND DATE(created_at) BETWEEN ? AND ?
        ''', (user_id, week_start, week_end))
        
        row = cur.fetchone()
        if row:
            report.total_questions = row[0] or 0
            report.total_correct = row[1] or 0
            report.total_time_minutes = int((row[2] or 0) / 60)
            report.study_days = row[3] or 0
        
        # 每日正確率趨勢
        for i in range(7):
            day = (start_date + timedelta(days=i)).strftime('%Y-%m-%d')
            cur.execute('''
                SELECT COUNT(*), SUM(is_correct)
                FROM adaptive_learning_log
                WHERE user_id = ? AND DATE(created_at) = ?
            ''', (user_id, day))
            
            row = cur.fetchone()
            if row and row[0] and row[0] > 0:
                acc = round(row[1] / row[0] * 100, 1)
            else:
                acc = 0
            report.accuracy_trend.append(acc)
        
        # 計算進步
        if len(report.accuracy_trend) >= 2:
            first_half = sum(report.accuracy_trend[:3]) / 3 if report.accuracy_trend[:3] else 0
            second_half = sum(report.accuracy_trend[4:]) / 3 if report.accuracy_trend[4:] else 0
            report.improvement = round(second_half - first_half, 1)
        
        # 弱點和強項
        cur.execute('''
            SELECT domain_id, COUNT(*), SUM(is_correct)
            FROM adaptive_learning_log
            WHERE user_id = ? AND DATE(created_at) BETWEEN ? AND ?
            GROUP BY domain_id
            HAVING COUNT(*) >= 5
        ''', (user_id, week_start, week_end))
        
        for row in cur.fetchall():
            if row[0]:
                acc = round(row[2] / row[1] * 100, 1)
                data = {'domain': row[0], 'accuracy': acc, 'attempts': row[1]}
                
                if acc < 60:
                    report.weak_areas.append(data)
                elif acc >= 80:
                    report.strong_areas.append(data)
        
        report.weak_areas.sort(key=lambda x: x['accuracy'])
        report.strong_areas.sort(key=lambda x: -x['accuracy'])
        
        conn.close()
        
        # 里程碑
        report.milestones = self._check_milestones(report)
        
        # 下週目標
        report.next_week_goals = self._generate_goals(report)
        
        return report
    
    def generate_readiness_report(self, user_id: str,
                                 cert_id: str) -> ReadinessReport:
        """生成認證準備度報告"""
        report = ReadinessReport(
            user_id=user_id,
            cert_id=cert_id,
            generated_at=datetime.now().isoformat()
        )
        
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        # 獲取領域列表
        cur.execute('''
            SELECT domain_id, domain_name
            FROM domain_knowledge_map
            WHERE cert_id = ?
        ''', (cert_id,))
        domains = {row[0]: row[1] for row in cur.fetchall()}
        
        # 計算每個領域的覆蓋度
        for domain_id, domain_name in domains.items():
            cur.execute('''
                SELECT COUNT(*), SUM(is_correct)
                FROM adaptive_learning_log
                WHERE user_id = ? AND cert_id = ? AND domain_id = ?
            ''', (user_id, cert_id, domain_id))
            
            row = cur.fetchone()
            if row and row[0] and row[0] > 0:
                coverage = min(100, row[0] * 5)  # 20題 = 100%覆蓋
                accuracy = round(row[1] / row[0] * 100, 1)
                
                report.domain_coverage[domain_id] = {
                    'name': domain_name,
                    'coverage': coverage,
                    'accuracy': accuracy,
                    'attempts': row[0]
                }
            else:
                report.uncovered_domains.append(domain_name)
        
        # 計算整體準備度
        if report.domain_coverage:
            coverages = [d['coverage'] for d in report.domain_coverage.values()]
            accuracies = [d['accuracy'] for d in report.domain_coverage.values()]
            
            avg_coverage = sum(coverages) / len(coverages)
            avg_accuracy = sum(accuracies) / len(accuracies)
            
            # 準備度 = 覆蓋率權重40% + 正確率權重60%
            report.overall_readiness = round(avg_coverage * 0.4 + avg_accuracy * 0.6, 1)
            
            # 預測分數
            report.predicted_score = int(avg_accuracy * 0.9)  # 保守估計
            
            # 通過概率
            if report.predicted_score >= 70:
                report.pass_probability = min(95, 50 + (report.predicted_score - 70) * 1.5)
            else:
                report.pass_probability = max(5, report.predicted_score - 20)
        
        conn.close()
        
        # 判斷準備度等級
        if report.overall_readiness >= 80:
            report.readiness_level = 'EXCELLENT'
            report.days_to_ready = 0
        elif report.overall_readiness >= 65:
            report.readiness_level = 'READY'
            report.days_to_ready = 3
        elif report.overall_readiness >= 50:
            report.readiness_level = 'ALMOST'
            report.days_to_ready = 7
        else:
            report.readiness_level = 'NOT_READY'
            report.days_to_ready = 14
        
        # 行動計畫
        report.action_plan = self._generate_action_plan(report)
        
        return report
    
    def _get_focus_areas(self, domain_stats: Dict) -> List[str]:
        """獲取重點領域"""
        weak = []
        for domain, stats in domain_stats.items():
            if stats['accuracy'] < 60:
                weak.append(domain)
        return weak[:3]
    
    def _get_encouragement(self, accuracy: float) -> str:
        """獲取激勵語"""
        import random
        
        if accuracy >= 90:
            level = 'excellent'
        elif accuracy >= 70:
            level = 'good'
        elif accuracy >= 50:
            level = 'average'
        else:
            level = 'needs_work'
        
        return random.choice(self.ENCOURAGEMENTS[level])
    
    def _check_milestones(self, report: WeeklyReport) -> List[str]:
        """檢查里程碑"""
        milestones = []
        
        if report.total_questions >= 100:
            milestones.append("🎯 本週完成 100+ 題練習！")
        if report.study_days >= 7:
            milestones.append("🔥 連續學習 7 天！")
        if report.improvement >= 10:
            milestones.append("📈 正確率提升 10%+！")
        if len(report.strong_areas) >= 3:
            milestones.append("💪 3+ 個領域達到精通！")
        
        return milestones
    
    def _generate_goals(self, report: WeeklyReport) -> List[str]:
        """生成下週目標"""
        goals = []
        
        if report.weak_areas:
            goals.append(f"加強 {report.weak_areas[0]['domain']} 領域")
        
        if report.total_questions < 70:
            goals.append("每天完成至少 10 題練習")
        
        if report.study_days < 5:
            goals.append("保持每天學習的習慣")
        
        goals.append("複習本週錯題")
        
        return goals[:4]
    
    def _generate_action_plan(self, report: ReadinessReport) -> List[str]:
        """生成行動計畫"""
        plan = []
        
        if report.uncovered_domains:
            plan.append(f"優先學習：{', '.join(report.uncovered_domains[:2])}")
        
        weak_domains = [d for d, v in report.domain_coverage.items() 
                       if v['accuracy'] < 60]
        if weak_domains:
            plan.append(f"加強練習：{weak_domains[0]}")
        
        if report.days_to_ready > 0:
            plan.append(f"建議再準備 {report.days_to_ready} 天")
        
        plan.append("完成至少一次完整模擬考")
        
        return plan
    
    def format_daily_report(self, report: DailyReport) -> str:
        """格式化每日報告"""
        lines = []
        lines.append("=" * 40)
        lines.append(f"📊 每日學習報告 - {report.date}")
        lines.append("=" * 40)
        
        lines.append(f"\n📝 今日練習: {report.questions_attempted} 題")
        lines.append(f"✅ 正確: {report.correct_count} 題 ({report.accuracy}%)")
        lines.append(f"⏱️ 學習時間: {report.time_spent_minutes} 分鐘")
        
        if report.vs_yesterday != 0:
            trend = "↑" if report.vs_yesterday > 0 else "↓"
            lines.append(f"📈 vs 昨日: {trend} {abs(report.vs_yesterday)}%")
        
        if report.new_wrong > 0:
            lines.append(f"\n❌ 新增錯題: {report.new_wrong}")
        if report.reviewed_wrong > 0:
            lines.append(f"🔄 複習錯題: {report.reviewed_wrong}")
        
        if report.focus_areas:
            lines.append(f"\n🎯 建議加強: {', '.join(report.focus_areas)}")
        
        lines.append(f"\n💬 {report.encouragement}")
        
        return "\n".join(lines)

# ============================================================
# 測試
# ============================================================

if __name__ == "__main__":
    print("=" * 55)
    print("學習報告生成器 R19 測試")
    print("=" * 55)
    
    generator = LearningReportGenerator('/home/claude/education_v54.db')
    
    user_id = 'test_report'
    cert_id = 'CERT001'
    
    # 每日報告
    print("\n生成每日報告...")
    daily = generator.generate_daily_report(user_id)
    print(generator.format_daily_report(daily))
    
    # 每週報告
    print("\n生成每週報告...")
    weekly = generator.generate_weekly_report(user_id)
    print(f"  學習天數: {weekly.study_days}")
    print(f"  總題數: {weekly.total_questions}")
    print(f"  趨勢: {weekly.accuracy_trend}")
    
    # 準備度報告
    print("\n生成準備度報告...")
    readiness = generator.generate_readiness_report(user_id, cert_id)
    print(f"  準備度: {readiness.overall_readiness}%")
    print(f"  等級: {readiness.readiness_level}")
    print(f"  預測分數: {readiness.predicted_score}")
    
    print("\n✅ R19 學習報告生成器完成")
