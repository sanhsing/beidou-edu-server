#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gsat_generator_v5_2.py - 學測題目生成器 v5.2
北斗七星文創 × 織明

v5.2 新增:
- ContextEnhancer: 情境強化（角色/場景隨機）
- DifficultyController: 難度控制
- VariantGenerator: 題目變體
- StatsTracker: 統計追蹤
- API endpoints: Flask 整合

用法:
    from gsat_generator_v5_2 import GSATGenerator, create_api
    
    gen = GSATGenerator('education.db')
    qset = gen.generate('PHY_momentum_01', difficulty='hard')
    
    # Flask API
    app = create_api(gen)
    app.run(port=5000)
"""

import sqlite3
import random
import math
import json
import os
from datetime import datetime
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, field, asdict
from enum import Enum

# ============================================================
# 資料結構
# ============================================================

class Difficulty(Enum):
    EASY = 'easy'
    MEDIUM = 'medium'
    HARD = 'hard'

@dataclass
class Question:
    qid: str
    level: str
    stem: str
    options: List[str]
    answer: str
    answer_value: Any
    explanation: str
    unit: str = ""
    difficulty_score: float = 0

@dataclass
class QuestionSet:
    node_id: str
    subject: str
    topic: str
    principle: str
    context: str
    questions: List[Question] = field(default_factory=list)
    variables: Dict = field(default_factory=dict)
    quality_score: float = 0
    difficulty: str = "medium"
    variant_id: str = ""
    generated_at: str = ""
    
    def __post_init__(self):
        if not self.generated_at:
            self.generated_at = datetime.now().isoformat()
        if not self.variant_id:
            self.variant_id = f"V{random.randint(1000,9999)}"
    
    def to_dict(self) -> Dict:
        return {
            'node_id': self.node_id,
            'subject': self.subject,
            'topic': self.topic,
            'principle': self.principle,
            'context': self.context,
            'questions': [asdict(q) for q in self.questions],
            'variables': self.variables,
            'quality_score': self.quality_score,
            'difficulty': self.difficulty,
            'variant_id': self.variant_id,
            'generated_at': self.generated_at
        }

# ============================================================
# A1: ContextEnhancer - 情境強化器
# ============================================================

class ContextEnhancer:
    """情境強化器 - 豐富情境描述"""
    
    # 角色名庫
    NAMES = {
        'male': ['小明', '阿傑', '志偉', '建宏', '俊賢', '家豪', '冠廷', '柏翰'],
        'female': ['小華', '小芳', '雅婷', '怡君', '佳蓉', '心怡', '詩涵', '欣怡'],
        'neutral': ['同學', '研究員', '實驗者', '學生']
    }
    
    # 場景描述
    SCENES = {
        '物理': ['在學校物理實驗室', '在科學館進行實驗', '參加科展準備', '進行課堂探究實驗'],
        '化學': ['在化學實驗室', '進行化學分析實驗', '參加化學奧林匹亞集訓', '進行滴定實驗'],
        '數學': ['在數學研究社', '準備數學競賽', '進行數學建模', '解決日常問題'],
        '生物': ['在生物實驗室', '進行生態觀察', '研究植物生理', '觀察細胞分裂'],
        '地科': ['在地球科學教室', '進行野外考察', '觀測天文現象', '分析地質樣本'],
        '國文': ['在國文課堂上', '閱讀經典文學', '準備作文比賽', '進行文本分析'],
        '英文': ['在英文課堂上', '準備英檢考試', '進行英語演講', '閱讀英文文章'],
        '歷史': ['在歷史課堂上', '參觀歷史博物館', '研究古文獻', '進行史料分析'],
        '地理': ['在地理教室', '進行田野調查', '分析地圖資料', '研究氣候變遷'],
        '公民': ['在公民課堂上', '參與模擬法庭', '討論時事議題', '進行公共政策分析']
    }
    
    # 開場詞
    INTROS = [
        '{name}是{school}的學生，對{subject}特別感興趣。',
        '{name}正在{scene}，進行一項有趣的探究活動。',
        '為了深入了解{topic}，{name}設計了一個實驗。',
        '{name}在老師的指導下，開始研究{topic}的相關問題。'
    ]
    
    def __init__(self):
        self.schools = ['建國中學', '北一女中', '台中一中', '高雄中學', '某高中']
    
    def enhance(self, context: str, subject: str, topic: str) -> str:
        """強化情境描述"""
        # 選擇角色
        gender = random.choice(['male', 'female', 'neutral'])
        name = random.choice(self.NAMES[gender])
        
        # 選擇場景
        scenes = self.SCENES.get(subject, ['在教室裡'])
        scene = random.choice(scenes)
        
        # 選擇學校
        school = random.choice(self.schools)
        
        # 生成開場
        intro = random.choice(self.INTROS).format(
            name=name, school=school, scene=scene, 
            subject=subject, topic=topic
        )
        
        # 替換原始情境中的名字
        enhanced = context
        for old_name in ['小明', '小華', '小芳', '小傑']:
            enhanced = enhanced.replace(old_name, name)
        
        # 加入開場（如果情境較短）
        if len(enhanced) < 80:
            enhanced = intro + '\n\n' + enhanced
        
        return enhanced
    
    def add_detail(self, context: str, variables: Dict) -> str:
        """添加細節描述"""
        details = []
        
        # 根據變數添加細節
        for var, val in variables.items():
            if isinstance(val, (int, float)) and val > 0:
                if 'mass' in var.lower() or 'm' == var:
                    details.append(f'質量經精密電子秤測量')
                elif 'time' in var.lower() or 't' == var:
                    details.append(f'時間由計時器精確記錄')
                elif 'rate' in var.lower():
                    details.append(f'速率經多次測量取平均')
        
        if details:
            detail_text = '（' + '，'.join(details[:2]) + '）'
            context = context.rstrip('。') + detail_text + '。'
        
        return context

# ============================================================
# A2: DifficultyController - 難度控制器
# ============================================================

class DifficultyController:
    """難度控制器 - 控制題目難度"""
    
    # 難度參數
    PARAMS = {
        'easy': {
            'value_range_factor': 0.5,    # 數值範圍縮小
            'trap_count': 1,               # 誘答數量少
            'calculation_steps': 1,        # 計算步驟少
            'score_range': (1.0, 2.5)
        },
        'medium': {
            'value_range_factor': 1.0,
            'trap_count': 2,
            'calculation_steps': 2,
            'score_range': (2.5, 4.0)
        },
        'hard': {
            'value_range_factor': 1.5,    # 數值範圍擴大
            'trap_count': 3,               # 誘答數量多
            'calculation_steps': 3,        # 計算步驟多
            'score_range': (4.0, 5.0)
        }
    }
    
    def __init__(self):
        self.current_difficulty = 'medium'
    
    def set_difficulty(self, difficulty: str):
        """設定難度"""
        if difficulty in self.PARAMS:
            self.current_difficulty = difficulty
    
    def adjust_values(self, vals_schema: Dict) -> Dict:
        """根據難度調整數值範圍"""
        factor = self.PARAMS[self.current_difficulty]['value_range_factor']
        adjusted = {}
        
        for var, spec in vals_schema.items():
            new_spec = spec.copy()
            
            if 'range' in spec:
                start, end = spec['range']
                mid = (start + end) / 2
                half_range = (end - start) / 2 * factor
                new_spec['range'] = [
                    max(start, mid - half_range),
                    min(end * 1.5, mid + half_range)
                ]
            
            adjusted[var] = new_spec
        
        return adjusted
    
    def get_difficulty_score(self, level: str) -> float:
        """計算難度分數"""
        base = {'basic': 1.5, 'apply': 3.0, 'extend': 4.5}.get(level, 3.0)
        min_s, max_s = self.PARAMS[self.current_difficulty]['score_range']
        
        # 根據難度調整
        adjusted = base * self.PARAMS[self.current_difficulty]['value_range_factor']
        return max(min_s, min(max_s, adjusted))
    
    def filter_by_difficulty(self, questions: List[Question], target: str) -> List[Question]:
        """過濾符合難度的題目"""
        min_s, max_s = self.PARAMS[target]['score_range']
        return [q for q in questions if min_s <= q.difficulty_score <= max_s]

# ============================================================
# A3: VariantGenerator - 題目變體器
# ============================================================

class VariantGenerator:
    """題目變體器 - 生成題目變體"""
    
    def __init__(self):
        self.variant_count = 0
    
    def generate_variants(self, seed: Dict, count: int = 3) -> List[Dict]:
        """生成多個變體的變數組合"""
        variants = []
        vals_schema = seed.get('vals_schema', {})
        
        for i in range(count):
            variant = self._generate_one_variant(vals_schema, i)
            variants.append(variant)
            self.variant_count += 1
        
        return variants
    
    def _generate_one_variant(self, vals_schema: Dict, index: int) -> Dict:
        """生成單一變體"""
        values = {}
        
        for var, spec in vals_schema.items():
            if 'value' in spec:
                values[var] = spec['value']
            elif 'choices' in spec:
                # 根據 index 選擇不同值
                choices = spec['choices']
                values[var] = choices[index % len(choices)]
            elif 'range' in spec:
                start, end = spec['range']
                step = spec.get('step', 1)
                choices = [start + i * step for i in range(int((end - start) / step) + 1)]
                # 使用不同的隨機種子
                random.seed(index * 1000 + hash(var))
                values[var] = random.choice(choices)
                random.seed()  # 重置
        
        return values
    
    def shuffle_options(self, options: List[str], answer_idx: int) -> Tuple[List[str], int]:
        """打亂選項順序"""
        if not options:
            return options, answer_idx
        
        # 建立索引映射
        indices = list(range(len(options)))
        random.shuffle(indices)
        
        # 重排選項
        shuffled = [options[i] for i in indices]
        
        # 找到新的答案位置
        new_answer_idx = indices.index(answer_idx)
        
        return shuffled, new_answer_idx

# ============================================================
# A4: StatsTracker - 統計追蹤器
# ============================================================

class StatsTracker:
    """統計追蹤器 - 記錄生成統計"""
    
    def __init__(self, db_path: str = None):
        self.db_path = db_path
        self.session_stats = {
            'total_generated': 0,
            'by_subject': {},
            'by_difficulty': {'easy': 0, 'medium': 0, 'hard': 0},
            'quality_sum': 0,
            'start_time': datetime.now().isoformat()
        }
        
        if db_path:
            self._init_db()
    
    def _init_db(self):
        """初始化統計表"""
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        cur.execute('''
            CREATE TABLE IF NOT EXISTS gsat_generation_log (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                node_id TEXT,
                subject TEXT,
                topic TEXT,
                difficulty TEXT,
                quality_score REAL,
                variant_id TEXT,
                variables_json TEXT,
                generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        cur.execute('''
            CREATE TABLE IF NOT EXISTS gsat_daily_stats (
                date TEXT PRIMARY KEY,
                total_count INTEGER DEFAULT 0,
                avg_quality REAL DEFAULT 0,
                subjects_json TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        ''')
        
        conn.commit()
        conn.close()
    
    def record(self, qset: QuestionSet):
        """記錄生成"""
        # 更新會話統計
        self.session_stats['total_generated'] += 1
        self.session_stats['quality_sum'] += qset.quality_score
        
        subj = qset.subject
        if subj not in self.session_stats['by_subject']:
            self.session_stats['by_subject'][subj] = 0
        self.session_stats['by_subject'][subj] += 1
        
        diff = qset.difficulty
        if diff in self.session_stats['by_difficulty']:
            self.session_stats['by_difficulty'][diff] += 1
        
        # 寫入 DB
        if self.db_path:
            self._write_to_db(qset)
    
    def _write_to_db(self, qset: QuestionSet):
        """寫入資料庫"""
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        cur.execute('''
            INSERT INTO gsat_generation_log 
            (node_id, subject, topic, difficulty, quality_score, variant_id, variables_json)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ''', (
            qset.node_id, qset.subject, qset.topic, qset.difficulty,
            qset.quality_score, qset.variant_id, json.dumps(qset.variables)
        ))
        
        conn.commit()
        conn.close()
    
    def get_stats(self) -> Dict:
        """取得統計"""
        total = self.session_stats['total_generated']
        avg_quality = self.session_stats['quality_sum'] / total if total > 0 else 0
        
        return {
            'session': {
                'total': total,
                'avg_quality': round(avg_quality, 1),
                'by_subject': self.session_stats['by_subject'],
                'by_difficulty': self.session_stats['by_difficulty']
            }
        }
    
    def get_daily_stats(self, days: int = 7) -> List[Dict]:
        """取得每日統計"""
        if not self.db_path:
            return []
        
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        cur.execute('''
            SELECT DATE(generated_at) as date, 
                   COUNT(*) as count,
                   AVG(quality_score) as avg_quality
            FROM gsat_generation_log
            WHERE generated_at >= DATE('now', ?)
            GROUP BY DATE(generated_at)
            ORDER BY date DESC
        ''', (f'-{days} days',))
        
        results = [{'date': r[0], 'count': r[1], 'avg_quality': round(r[2], 1)} 
                   for r in cur.fetchall()]
        
        conn.close()
        return results

# ============================================================
# 核心引擎（整合 v5.1）
# ============================================================

class SeedManager:
    """種子管理器"""
    
    def __init__(self, db_path: str = None):
        self.db_path = db_path
        self.seeds: Dict[str, Dict] = {}
        
        if db_path and os.path.exists(db_path):
            self._load_from_db()
    
    def _load_from_db(self):
        """從 DB 載入種子"""
        try:
            conn = sqlite3.connect(self.db_path)
            cur = conn.cursor()
            
            cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='gsat_seeds'")
            if cur.fetchone():
                cur.execute("SELECT node_id, seed_json FROM gsat_seeds")
                for node_id, seed_json in cur.fetchall():
                    self.seeds[node_id] = json.loads(seed_json)
            
            conn.close()
        except Exception as e:
            print(f"⚠️ 載入種子失敗: {e}")
    
    def get(self, node_id: str) -> Optional[Dict]:
        return self.seeds.get(node_id)
    
    def list_by_subject(self, subject: str) -> List[str]:
        return [k for k, v in self.seeds.items() if v['subject'] == subject]
    
    def list_all(self) -> List[str]:
        return list(self.seeds.keys())
    
    def get_subjects(self) -> List[str]:
        return list(set(v['subject'] for v in self.seeds.values()))


class QuestionEngine:
    """出題引擎"""
    
    def __init__(self):
        self.trap_gen = TrapGenerator()
    
    def generate_values(self, vals_schema: Dict) -> Dict:
        values = {}
        for var, spec in vals_schema.items():
            if 'value' in spec:
                values[var] = spec['value']
            elif 'choices' in spec:
                values[var] = random.choice(spec['choices'])
            elif 'range' in spec:
                start, end = spec['range']
                step = spec.get('step', 1)
                choices = [start + i * step for i in range(int((end - start) / step) + 1)]
                values[var] = random.choice(choices)
        return values
    
    def eval_expr(self, expr: str, values: Dict) -> Any:
        def C(n, r):
            if r > n or r < 0:
                return 0
            return math.factorial(int(n)) // (math.factorial(int(r)) * math.factorial(int(n - r)))
        
        ns = values.copy()
        ns['C'] = C
        ns['sqrt'] = math.sqrt
        ns['abs'] = abs
        ns['max'] = max
        ns['min'] = min
        ns['pi'] = math.pi
        
        try:
            return eval(expr, {"__builtins__": {}}, ns)
        except:
            return None
    
    def fill_template(self, template: str, values: Dict) -> str:
        result = template
        for var, val in values.items():
            formatted = self._format_number(val)
            result = result.replace('{' + var + '}', str(formatted))
        return result
    
    def _format_number(self, num: Any) -> str:
        if isinstance(num, str):
            return num
        if num is None:
            return "N/A"
        if isinstance(num, tuple):
            return str(num)
        if num == 0:
            return "0"
        if abs(num) >= 1e6 or (abs(num) < 0.01 and num != 0):
            return f"{num:.2e}"
        if isinstance(num, float):
            if num == int(num):
                return str(int(num))
            return f"{num:.4f}".rstrip('0').rstrip('.')
        return str(num)
    
    def generate_question(self, q_template: Dict, values: Dict, difficulty_score: float = 3.0) -> Question:
        ans_value = self.eval_expr(q_template['answer_expr'], values)
        
        extended_values = values.copy()
        extended_values['ans'] = self._format_number(ans_value)
        
        if isinstance(ans_value, str):
            options = []
            ans_letter = ans_value if len(ans_value) == 1 else 'A'
        else:
            traps = self.trap_gen.generate(ans_value, q_template.get('trap_rules', []), values)
            all_opts = [ans_value] + traps
            random.shuffle(all_opts)
            ans_idx = all_opts.index(ans_value)
            ans_letter = chr(65 + ans_idx)
            options = [f"({chr(65+i)}) {self._format_number(v)} {q_template.get('unit', '')}" 
                      for i, v in enumerate(all_opts)]
        
        explanation = self.fill_template(q_template['explanation'], extended_values)
        
        return Question(
            qid=f"Q_{datetime.now().strftime('%H%M%S%f')[:10]}",
            level=q_template['level'],
            stem=q_template['stem'],
            options=options,
            answer=ans_letter,
            answer_value=ans_value,
            explanation=explanation,
            unit=q_template.get('unit', ''),
            difficulty_score=difficulty_score
        )


class TrapGenerator:
    """誘答生成器"""
    
    def generate(self, correct: Any, trap_rules: List[Dict], values: Dict) -> List[float]:
        traps = []
        
        for rule in trap_rules:
            if 'expr' in rule:
                try:
                    trap_val = self._eval_trap(rule['expr'], values)
                    if trap_val is not None and trap_val != correct and trap_val not in traps:
                        if abs(trap_val) > 0.0001 or trap_val == 0:
                            traps.append(trap_val)
                except:
                    pass
        
        if isinstance(correct, (int, float)) and correct != 0:
            patterns = [correct * 2, correct / 2, correct * 10, correct / 10,
                       correct * 1.1, correct * 0.9, -correct]
            
            for p in patterns:
                if len(traps) >= 3:
                    break
                if p != correct and p not in traps and abs(p) > 0.0001:
                    traps.append(round(p, 4))
        
        while len(traps) < 3:
            if isinstance(correct, (int, float)) and correct != 0:
                offset = random.choice([0.5, 0.7, 1.3, 1.5, 2.0])
                trap = correct * offset
                if trap != correct and trap not in traps:
                    traps.append(round(trap, 4))
            else:
                break
        
        return traps[:3]
    
    def _eval_trap(self, expr: str, values: Dict) -> Any:
        def C(n, r):
            if r > n or r < 0:
                return 0
            return math.factorial(int(n)) // (math.factorial(int(r)) * math.factorial(int(n - r)))
        
        ns = values.copy()
        ns['C'] = C
        ns['sqrt'] = math.sqrt
        ns['abs'] = abs
        
        try:
            return eval(expr, {"__builtins__": {}}, ns)
        except:
            return None


class QualityChecker:
    """品質檢查器"""
    
    WEIGHTS = {'structure': 0.20, 'calculation': 0.25, 'traps': 0.20, 
               'difficulty': 0.20, 'context': 0.15}
    
    def check(self, qset: QuestionSet) -> Dict:
        scores = {}
        issues = []
        
        # 結構
        score = 100
        if len(qset.questions) != 3:
            score -= 30
            issues.append(f'題數應為3')
        if len(qset.principle) < 30:
            score -= 20
        scores['structure'] = max(0, score)
        
        # 計算
        score = 100
        for q in qset.questions:
            if q.answer_value is None:
                score -= 30
        scores['calculation'] = max(0, score)
        
        # 誘答
        score = 100
        for q in qset.questions:
            if q.options:
                opt_values = [o.split(')')[1].strip() if ')' in o else o for o in q.options]
                if len(set(opt_values)) != len(opt_values):
                    score -= 25
        scores['traps'] = max(0, score)
        
        # 難度
        score = 100
        levels = [q.level for q in qset.questions]
        if levels != ['basic', 'apply', 'extend']:
            score -= 50
        scores['difficulty'] = max(0, score)
        
        # 情境
        score = 100
        if '{' in qset.context and '}' in qset.context:
            score -= 40
        if len(qset.context) < 50:
            score -= 30
        scores['context'] = max(0, score)
        
        total = sum(scores[k] * self.WEIGHTS[k] for k in scores)
        
        if total >= 95:
            grade = 'S'
        elif total >= 85:
            grade = 'A'
        elif total >= 70:
            grade = 'B'
        elif total >= 60:
            grade = 'C'
        else:
            grade = 'D'
        
        return {'scores': scores, 'total_score': round(total, 1), 'grade': grade, 'issues': issues}

# ============================================================
# A6: 主類別 GSATGenerator v5.2
# ============================================================

class GSATGenerator:
    """學測題目生成器 v5.2"""
    
    def __init__(self, db_path: str = None):
        self.db_path = db_path
        self.seed_mgr = SeedManager(db_path)
        self.engine = QuestionEngine()
        self.checker = QualityChecker()
        
        # v5.2 新增
        self.context_enhancer = ContextEnhancer()
        self.difficulty_ctrl = DifficultyController()
        self.variant_gen = VariantGenerator()
        self.stats = StatsTracker(db_path)
    
    def generate(self, node_id: str, difficulty: str = 'medium', 
                 enhance_context: bool = True, custom_values: Dict = None) -> Optional[QuestionSet]:
        """生成題組"""
        seed = self.seed_mgr.get(node_id)
        if not seed:
            print(f"⚠️ 找不到種子: {node_id}")
            return None
        
        # 設定難度
        self.difficulty_ctrl.set_difficulty(difficulty)
        
        # 調整數值範圍
        adjusted_schema = self.difficulty_ctrl.adjust_values(seed['vals_schema'])
        
        # 生成變數
        values = self.engine.generate_values(adjusted_schema)
        if custom_values:
            values.update(custom_values)
        
        # 填充情境
        context = self.engine.fill_template(seed['context_template'], values)
        
        # 強化情境
        if enhance_context:
            context = self.context_enhancer.enhance(context, seed['subject'], seed['topic'])
            context = self.context_enhancer.add_detail(context, values)
        
        # 生成題目
        questions = []
        for q_tmpl in seed['q_templates']:
            diff_score = self.difficulty_ctrl.get_difficulty_score(q_tmpl['level'])
            q = self.engine.generate_question(q_tmpl, values, diff_score)
            questions.append(q)
        
        qset = QuestionSet(
            node_id=seed['node_id'],
            subject=seed['subject'],
            topic=seed['topic'],
            principle=seed['principle'],
            context=context,
            questions=questions,
            variables=values,
            difficulty=difficulty
        )
        
        # 品質檢查
        report = self.checker.check(qset)
        qset.quality_score = report['total_score']
        
        # 記錄統計
        self.stats.record(qset)
        
        return qset
    
    def generate_variants(self, node_id: str, count: int = 3, 
                          difficulty: str = 'medium') -> List[QuestionSet]:
        """生成多個變體"""
        seed = self.seed_mgr.get(node_id)
        if not seed:
            return []
        
        variants = self.variant_gen.generate_variants(seed, count)
        results = []
        
        for var_values in variants:
            qset = self.generate(node_id, difficulty=difficulty, 
                                custom_values=var_values, enhance_context=True)
            if qset:
                results.append(qset)
        
        return results
    
    def batch_generate(self, subject: str = None, count: int = 10, 
                       difficulty: str = 'medium', min_quality: float = 70) -> List[QuestionSet]:
        """批量生成"""
        seeds = self.seed_mgr.list_by_subject(subject) if subject else self.seed_mgr.list_all()
        if not seeds:
            return []
        
        results = []
        attempts = 0
        max_attempts = count * 3
        
        while len(results) < count and attempts < max_attempts:
            node_id = random.choice(seeds)
            qset = self.generate(node_id, difficulty=difficulty)
            
            if qset and qset.quality_score >= min_quality:
                results.append(qset)
            
            attempts += 1
        
        return results
    
    def get_stats(self) -> Dict:
        """取得統計"""
        return self.stats.get_stats()
    
    def list_seeds(self, subject: str = None) -> List[str]:
        if subject:
            return self.seed_mgr.list_by_subject(subject)
        return self.seed_mgr.list_all()
    
    def get_subjects(self) -> List[str]:
        return self.seed_mgr.get_subjects()
    
    def format(self, qset: QuestionSet) -> str:
        """格式化輸出"""
        lines = []
        lines.append("=" * 60)
        lines.append(f"【{qset.subject}】{qset.topic} [{qset.difficulty.upper()}] {qset.variant_id}")
        lines.append("=" * 60)
        lines.append("")
        lines.append("【原理說明】")
        lines.append(qset.principle)
        lines.append("")
        lines.append("【題目情境】")
        lines.append(qset.context)
        lines.append("")
        
        level_map = {'basic': '基礎', 'apply': '應用', 'extend': '進階'}
        
        for i, q in enumerate(qset.questions, 1):
            lines.append(f"第 {i} 題 ({level_map.get(q.level, q.level)}) [難度 {q.difficulty_score:.1f}]")
            lines.append(q.stem)
            for opt in q.options:
                lines.append(f"  {opt}")
            lines.append(f"【答案】{q.answer}")
            lines.append(f"【解析】{q.explanation}")
            lines.append("")
        
        lines.append("=" * 60)
        lines.append(f"品質: {qset.quality_score}/100 | 生成: {qset.generated_at[:19]}")
        
        return "\n".join(lines)

# ============================================================
# A5: API 端點
# ============================================================

def create_api(generator: GSATGenerator):
    """建立 Flask API"""
    try:
        from flask import Flask, request, jsonify
    except ImportError:
        print("⚠️ Flask 未安裝，API 功能停用")
        return None
    
    app = Flask(__name__)
    
    @app.route('/api/gsat/seeds', methods=['GET'])
    def list_seeds():
        subject = request.args.get('subject')
        seeds = generator.list_seeds(subject)
        return jsonify({'success': True, 'data': seeds, 'count': len(seeds)})
    
    @app.route('/api/gsat/subjects', methods=['GET'])
    def list_subjects():
        subjects = generator.get_subjects()
        return jsonify({'success': True, 'data': subjects})
    
    @app.route('/api/gsat/generate', methods=['POST'])
    def generate():
        data = request.get_json() or {}
        node_id = data.get('node_id')
        difficulty = data.get('difficulty', 'medium')
        
        if not node_id:
            return jsonify({'success': False, 'error': 'node_id required'}), 400
        
        qset = generator.generate(node_id, difficulty=difficulty)
        if qset:
            return jsonify({'success': True, 'data': qset.to_dict()})
        else:
            return jsonify({'success': False, 'error': 'Generation failed'}), 500
    
    @app.route('/api/gsat/batch', methods=['POST'])
    def batch():
        data = request.get_json() or {}
        subject = data.get('subject')
        count = min(data.get('count', 10), 50)
        difficulty = data.get('difficulty', 'medium')
        
        qsets = generator.batch_generate(subject=subject, count=count, difficulty=difficulty)
        return jsonify({
            'success': True, 
            'data': [qs.to_dict() for qs in qsets],
            'count': len(qsets)
        })
    
    @app.route('/api/gsat/variants', methods=['POST'])
    def variants():
        data = request.get_json() or {}
        node_id = data.get('node_id')
        count = min(data.get('count', 3), 10)
        
        if not node_id:
            return jsonify({'success': False, 'error': 'node_id required'}), 400
        
        qsets = generator.generate_variants(node_id, count=count)
        return jsonify({
            'success': True,
            'data': [qs.to_dict() for qs in qsets],
            'count': len(qsets)
        })
    
    @app.route('/api/gsat/stats', methods=['GET'])
    def stats():
        return jsonify({'success': True, 'data': generator.get_stats()})
    
    return app

# ============================================================
# CLI 測試
# ============================================================

if __name__ == "__main__":
    print("=" * 60)
    print("GSAT Generator v5.2 - 深度優化版")
    print("=" * 60)
    
    # 使用 v53 DB
    db_path = '/home/claude/v53/education_v53.db'
    gen = GSATGenerator(db_path)
    
    seeds = gen.list_seeds()
    print(f"\n可用種子: {len(seeds)} 個")
    print(f"科目: {gen.get_subjects()}")
    
    # 測試不同難度
    print("\n【難度測試】")
    for diff in ['easy', 'medium', 'hard']:
        qset = gen.generate('PHY_momentum_01', difficulty=diff)
        if qset:
            print(f"  {diff.upper():6} - 品質: {qset.quality_score}, 難度分: {[q.difficulty_score for q in qset.questions]}")
    
    # 測試變體
    print("\n【變體測試】")
    variants = gen.generate_variants('MATH_prob_01', count=3)
    for v in variants:
        print(f"  {v.variant_id}: 答案 = {[q.answer_value for q in v.questions]}")
    
    # 測試批量
    print("\n【批量測試】")
    batch = gen.batch_generate(count=5, difficulty='medium')
    for qs in batch:
        print(f"  {qs.subject} - {qs.topic}: {qs.quality_score}分")
    
    # 顯示統計
    print("\n【統計】")
    stats = gen.get_stats()
    print(f"  總生成: {stats['session']['total']}")
    print(f"  平均品質: {stats['session']['avg_quality']}")
    print(f"  難度分布: {stats['session']['by_difficulty']}")
    
    # 輸出一個完整題組
    print("\n" + "=" * 60)
    print("【完整題組示範】")
    qset = gen.generate('CHEM_mole_01', difficulty='medium')
    if qset:
        print(gen.format(qset))
    
    print("\n✅ v5.2 測試完成")
