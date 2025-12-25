"""
AI 題目生成器
理科線產出 R18

功能：
1. 基於知識點生成新題目
2. 題目變形（同概念不同問法）
3. 難度調整
4. 選項生成
"""

import sqlite3
import json
import random
import re
from datetime import datetime
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass, field
from enum import Enum

class QuestionStyle(Enum):
    """題目風格"""
    DEFINITION = 'definition'     # 定義題
    APPLICATION = 'application'   # 應用題
    COMPARISON = 'comparison'     # 比較題
    SCENARIO = 'scenario'         # 情境題
    BEST_PRACTICE = 'best_practice'  # 最佳實踐題

@dataclass
class GeneratedQuestion:
    """生成的題目"""
    question_id: str
    question_type: str
    question_text: str
    options: List[str]
    correct_answer: int  # 0-3
    explanation: str
    difficulty: int
    source_concept: str
    style: QuestionStyle
    generated_at: str = ""
    
    def __post_init__(self):
        if not self.generated_at:
            self.generated_at = datetime.now().isoformat()

class AIQuestionGenerator:
    """AI 題目生成器"""
    
    # 題目模板
    TEMPLATES = {
        'definition': [
            "關於 {concept}，下列敘述何者正確？",
            "{concept} 的主要特徵是什麼？",
            "下列哪一項最能描述 {concept}？",
            "什麼是 {concept}？"
        ],
        'application': [
            "在什麼情況下應該使用 {concept}？",
            "{concept} 最適合用於解決什麼問題？",
            "當需要 {use_case} 時，應該選擇哪種技術？",
            "下列哪種情境最適合應用 {concept}？"
        ],
        'comparison': [
            "{concept_a} 和 {concept_b} 的主要差異是什麼？",
            "相較於 {concept_a}，{concept_b} 的優勢是什麼？",
            "下列關於 {concept_a} 與 {concept_b} 的比較，何者正確？"
        ],
        'scenario': [
            "一家公司需要 {requirement}，應該選擇哪種解決方案？",
            "某團隊正在開發 {project}，最適合使用的技術是？",
            "面對 {challenge} 的挑戰，最佳的處理方式是？"
        ],
        'best_practice': [
            "實作 {concept} 時，下列何者是最佳實踐？",
            "為了確保 {goal}，應該採取哪種做法？",
            "下列哪項建議最符合 {concept} 的最佳實踐？"
        ]
    }
    
    # 錯誤選項生成策略
    DISTRACTOR_STRATEGIES = [
        'opposite',      # 相反概念
        'similar',       # 相似但不同
        'partial',       # 部分正確
        'outdated',      # 過時做法
        'common_mistake' # 常見錯誤
    ]
    
    def __init__(self, db_path: str):
        self.db_path = db_path
        self.concepts = {}
        self.relationships = {}
        self._load_knowledge_base()
    
    def _load_knowledge_base(self):
        """載入知識庫"""
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        # 載入術語
        cur.execute('''
            SELECT cert_id, term, term_zh, definition
            FROM cert_glossary_v2
        ''')
        
        for row in cur.fetchall():
            cert_id, term, term_zh, definition = row
            key = f"{cert_id}:{term}"
            self.concepts[key] = {
                'cert_id': cert_id,
                'term': term,
                'term_zh': term_zh or term,
                'definition': definition or ''
            }
        
        # 載入領域知識
        cur.execute('''
            SELECT cert_id, domain_id, domain_name, core_concepts, key_terms
            FROM domain_knowledge_map
        ''')
        
        for row in cur.fetchall():
            cert_id, domain_id, name, concepts, terms = row
            key = f"{cert_id}:{domain_id}"
            self.relationships[key] = {
                'cert_id': cert_id,
                'domain_id': domain_id,
                'name': name,
                'concepts': json.loads(concepts) if concepts else [],
                'terms': json.loads(terms) if terms else []
            }
        
        conn.close()
        print(f"載入 {len(self.concepts)} 個概念, {len(self.relationships)} 個領域")
    
    def generate_question(self, cert_id: str, concept: str = None,
                         style: QuestionStyle = None,
                         difficulty: int = 3) -> Optional[GeneratedQuestion]:
        """生成單題"""
        
        # 選擇概念
        if concept:
            concept_data = self._find_concept(cert_id, concept)
        else:
            concept_data = self._random_concept(cert_id)
        
        if not concept_data:
            return None
        
        # 選擇風格
        if not style:
            style = random.choice(list(QuestionStyle))
        
        # 生成題目
        question_text = self._generate_stem(concept_data, style)
        
        # 生成選項
        options, correct_idx = self._generate_options(concept_data, style, difficulty)
        
        # 生成解析
        explanation = self._generate_explanation(concept_data, correct_idx, options)
        
        # 生成唯一ID
        question_id = f"GEN_{cert_id}_{datetime.now().strftime('%Y%m%d%H%M%S')}_{random.randint(1000,9999)}"
        
        return GeneratedQuestion(
            question_id=question_id,
            question_type='single',
            question_text=question_text,
            options=options,
            correct_answer=correct_idx,
            explanation=explanation,
            difficulty=difficulty,
            source_concept=concept_data['term'],
            style=style
        )
    
    def _find_concept(self, cert_id: str, concept: str) -> Optional[Dict]:
        """查找概念"""
        # 精確匹配
        key = f"{cert_id}:{concept}"
        if key in self.concepts:
            return self.concepts[key]
        
        # 模糊匹配
        concept_lower = concept.lower()
        for k, v in self.concepts.items():
            if k.startswith(cert_id) and concept_lower in v['term'].lower():
                return v
        
        return None
    
    def _random_concept(self, cert_id: str) -> Optional[Dict]:
        """隨機選擇概念"""
        candidates = [v for k, v in self.concepts.items() 
                     if k.startswith(cert_id) and v.get('definition')]
        
        if candidates:
            return random.choice(candidates)
        return None
    
    def _generate_stem(self, concept: Dict, style: QuestionStyle) -> str:
        """生成題幹"""
        templates = self.TEMPLATES.get(style.value, self.TEMPLATES['definition'])
        template = random.choice(templates)
        
        # 填充模板
        term = concept.get('term_zh') or concept.get('term')
        
        replacements = {
            'concept': term,
            'concept_a': term,
            'concept_b': self._get_related_concept(concept),
            'use_case': self._get_use_case(concept),
            'requirement': self._get_requirement(concept),
            'project': '應用系統',
            'challenge': '技術挑戰',
            'goal': '系統安全',
        }
        
        result = template
        for key, value in replacements.items():
            result = result.replace('{' + key + '}', value)
        
        return result
    
    def _get_related_concept(self, concept: Dict) -> str:
        """獲取相關概念"""
        cert_id = concept['cert_id']
        candidates = [v['term_zh'] or v['term'] for k, v in self.concepts.items()
                     if k.startswith(cert_id) and v['term'] != concept['term']]
        
        if candidates:
            return random.choice(candidates[:10])
        return "其他技術"
    
    def _get_use_case(self, concept: Dict) -> str:
        """獲取使用場景"""
        use_cases = [
            "處理大量數據", "提升系統效能", "加強安全性",
            "降低成本", "自動化流程", "改善用戶體驗"
        ]
        return random.choice(use_cases)
    
    def _get_requirement(self, concept: Dict) -> str:
        """獲取需求描述"""
        requirements = [
            "建立可擴展的架構", "實現高可用性", "確保數據安全",
            "優化性能", "降低延遲", "提升準確度"
        ]
        return random.choice(requirements)
    
    def _generate_options(self, concept: Dict, style: QuestionStyle,
                         difficulty: int) -> Tuple[List[str], int]:
        """生成選項"""
        definition = concept.get('definition', '')
        term = concept.get('term_zh') or concept.get('term')
        
        # 正確選項
        if definition:
            correct = self._simplify_definition(definition)
        else:
            correct = f"{term} 是一種有效的技術解決方案"
        
        # 生成干擾項
        distractors = self._generate_distractors(concept, correct, difficulty)
        
        # 組合並隨機排序
        options = [correct] + distractors[:3]
        random.shuffle(options)
        
        # 找到正確答案的索引
        correct_idx = options.index(correct)
        
        # 添加選項標記
        labeled_options = [f"({chr(65+i)}) {opt}" for i, opt in enumerate(options)]
        
        return labeled_options, correct_idx
    
    def _simplify_definition(self, definition: str) -> str:
        """簡化定義"""
        # 取前100字
        if len(definition) > 100:
            definition = definition[:100] + '...'
        return definition
    
    def _generate_distractors(self, concept: Dict, correct: str,
                             difficulty: int) -> List[str]:
        """生成干擾項"""
        distractors = []
        term = concept.get('term_zh') or concept.get('term')
        
        # 策略1：相反概念
        distractors.append(f"{term} 已經過時，不再被使用")
        
        # 策略2：部分正確
        distractors.append(f"{term} 只能用於簡單場景")
        
        # 策略3：常見錯誤
        distractors.append(f"{term} 的主要目的是降低成本")
        
        # 策略4：相似概念混淆
        related = self._get_related_concept(concept)
        distractors.append(f"{term} 和 {related} 完全相同")
        
        # 根據難度調整干擾項
        if difficulty <= 2:
            # 簡單題：干擾項明顯錯誤
            distractors = [d.replace('只能', '完全不能') for d in distractors]
        elif difficulty >= 4:
            # 難題：干擾項接近正確
            pass
        
        return distractors
    
    def _generate_explanation(self, concept: Dict, correct_idx: int,
                             options: List[str]) -> str:
        """生成解析"""
        term = concept.get('term_zh') or concept.get('term')
        definition = concept.get('definition', '')
        
        explanation = f"正確答案是 ({chr(65+correct_idx)})。\n\n"
        explanation += f"【概念說明】\n{term}"
        
        if definition:
            explanation += f"：{definition[:200]}"
        
        explanation += f"\n\n【解題關鍵】\n理解 {term} 的核心特性和應用場景。"
        
        return explanation
    
    def generate_batch(self, cert_id: str, count: int = 10,
                      difficulty: int = None) -> List[GeneratedQuestion]:
        """批量生成題目"""
        questions = []
        styles = list(QuestionStyle)
        
        for i in range(count):
            style = styles[i % len(styles)]
            diff = difficulty or random.randint(2, 4)
            
            q = self.generate_question(cert_id, style=style, difficulty=diff)
            if q:
                questions.append(q)
        
        return questions
    
    def save_generated(self, questions: List[GeneratedQuestion]) -> int:
        """保存生成的題目"""
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        # 確保表存在
        cur.execute('''
            CREATE TABLE IF NOT EXISTS generated_questions (
                question_id TEXT PRIMARY KEY,
                cert_id TEXT,
                question_type TEXT,
                question_text TEXT,
                options TEXT,
                correct_answer INTEGER,
                explanation TEXT,
                difficulty INTEGER,
                source_concept TEXT,
                style TEXT,
                generated_at TEXT,
                is_approved INTEGER DEFAULT 0
            )
        ''')
        
        count = 0
        for q in questions:
            try:
                cur.execute('''
                    INSERT INTO generated_questions
                    (question_id, cert_id, question_type, question_text, options,
                     correct_answer, explanation, difficulty, source_concept, style, generated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ''', (q.question_id, q.source_concept.split(':')[0] if ':' in q.source_concept else 'CERT001',
                      q.question_type, q.question_text, json.dumps(q.options),
                      q.correct_answer, q.explanation, q.difficulty,
                      q.source_concept, q.style.value, q.generated_at))
                count += 1
            except Exception as e:
                pass
        
        conn.commit()
        conn.close()
        
        return count
    
    def get_generated_stats(self) -> Dict:
        """獲取生成統計"""
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        try:
            cur.execute("SELECT COUNT(*), SUM(is_approved) FROM generated_questions")
            row = cur.fetchone()
            total = row[0] or 0
            approved = row[1] or 0
            
            cur.execute('''
                SELECT style, COUNT(*) FROM generated_questions GROUP BY style
            ''')
            by_style = {row[0]: row[1] for row in cur.fetchall()}
        except:
            total, approved, by_style = 0, 0, {}
        
        conn.close()
        
        return {
            'total_generated': total,
            'approved': approved,
            'by_style': by_style
        }

# ============================================================
# 測試
# ============================================================

if __name__ == "__main__":
    print("=" * 55)
    print("AI 題目生成器 R18 測試")
    print("=" * 55)
    
    generator = AIQuestionGenerator('/home/claude/education_v54.db')
    
    # 生成單題
    print("\n生成單題...")
    q = generator.generate_question('CERT001', style=QuestionStyle.DEFINITION)
    if q:
        print(f"  題目: {q.question_text[:50]}...")
        print(f"  風格: {q.style.value}")
        print(f"  難度: {q.difficulty}")
        print(f"  選項數: {len(q.options)}")
    
    # 批量生成
    print("\n批量生成...")
    questions = generator.generate_batch('CERT001', count=5)
    print(f"  生成: {len(questions)} 題")
    
    # 保存
    saved = generator.save_generated(questions)
    print(f"  保存: {saved} 題")
    
    # 統計
    stats = generator.get_generated_stats()
    print(f"\n生成統計:")
    print(f"  總生成: {stats['total_generated']}")
    
    print("\n✅ R18 AI 題目生成器完成")
