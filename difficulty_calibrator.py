"""
難度智能校準系統
理科線產出 R12

功能：
1. 基於題目特徵計算難度
2. 校準現有難度標記
3. 難度分布平衡
"""

import sqlite3
import json
import re
import math
from typing import Dict, List, Tuple
from dataclasses import dataclass
from collections import defaultdict

@dataclass
class DifficultyFactors:
    """難度因子"""
    text_complexity: float    # 文本複雜度
    option_similarity: float  # 選項相似度
    concept_count: float      # 概念數量
    calculation_depth: float  # 計算深度
    scenario_complexity: float # 情境複雜度

class DifficultyCalibrator:
    """難度智能校準系統"""
    
    # 難度權重
    WEIGHTS = {
        'text_complexity': 0.2,
        'option_similarity': 0.2,
        'concept_count': 0.25,
        'calculation_depth': 0.15,
        'scenario_complexity': 0.2
    }
    
    # 複雜詞彙（增加難度）
    COMPLEX_TERMS = {
        'en': ['implement', 'optimize', 'architecture', 'infrastructure', 
               'compliance', 'governance', 'orchestration', 'integration',
               'scalability', 'latency', 'throughput', 'redundancy'],
        'zh': ['架構', '優化', '整合', '治理', '合規', '協調', '部署',
               '擴展性', '延遲', '吞吐量', '冗餘', '容錯']
    }
    
    # 計算關鍵詞
    CALC_KEYWORDS = ['calculate', 'compute', 'estimate', 'formula',
                     '計算', '估算', '公式', '數值']
    
    def __init__(self, db_path: str):
        self.db_path = db_path
    
    def analyze_question(self, question_text: str, options: List[str] = None,
                        scenario: str = None) -> DifficultyFactors:
        """分析單題難度因子"""
        
        # 1. 文本複雜度
        text_complexity = self._calc_text_complexity(question_text)
        
        # 2. 選項相似度
        option_similarity = self._calc_option_similarity(options) if options else 0.5
        
        # 3. 概念數量
        concept_count = self._count_concepts(question_text)
        
        # 4. 計算深度
        calculation_depth = self._calc_depth(question_text)
        
        # 5. 情境複雜度
        scenario_complexity = self._calc_scenario_complexity(scenario or question_text)
        
        return DifficultyFactors(
            text_complexity=text_complexity,
            option_similarity=option_similarity,
            concept_count=concept_count,
            calculation_depth=calculation_depth,
            scenario_complexity=scenario_complexity
        )
    
    def _calc_text_complexity(self, text: str) -> float:
        """計算文本複雜度 (0-1)"""
        if not text:
            return 0.5
        
        score = 0.0
        
        # 長度因子
        length = len(text)
        if length > 500:
            score += 0.3
        elif length > 200:
            score += 0.2
        elif length > 100:
            score += 0.1
        
        # 複雜詞彙
        text_lower = text.lower()
        complex_count = sum(1 for term in self.COMPLEX_TERMS['en'] 
                          if term in text_lower)
        complex_count += sum(1 for term in self.COMPLEX_TERMS['zh'] 
                            if term in text)
        score += min(complex_count * 0.05, 0.3)
        
        # 句子長度
        sentences = re.split(r'[.!?。！？]', text)
        avg_sentence_len = sum(len(s) for s in sentences) / max(len(sentences), 1)
        if avg_sentence_len > 100:
            score += 0.2
        elif avg_sentence_len > 50:
            score += 0.1
        
        return min(score, 1.0)
    
    def _calc_option_similarity(self, options: List[str]) -> float:
        """計算選項相似度 (0-1)，相似度高=難度高"""
        if not options or len(options) < 2:
            return 0.5
        
        # 簡化：計算選項長度變異係數
        lengths = [len(str(opt)) for opt in options]
        mean_len = sum(lengths) / len(lengths)
        variance = sum((l - mean_len) ** 2 for l in lengths) / len(lengths)
        cv = math.sqrt(variance) / max(mean_len, 1)
        
        # 變異係數低 = 選項長度相似 = 難度高
        similarity = max(0, 1 - cv)
        
        # 檢查選項是否有共同前綴
        if all(isinstance(opt, str) for opt in options):
            common_prefix = len(self._common_prefix(options))
            if common_prefix > 5:
                similarity += 0.2
        
        return min(similarity, 1.0)
    
    def _common_prefix(self, strings: List[str]) -> str:
        """找共同前綴"""
        if not strings:
            return ""
        prefix = strings[0]
        for s in strings[1:]:
            while not s.startswith(prefix):
                prefix = prefix[:-1]
                if not prefix:
                    return ""
        return prefix
    
    def _count_concepts(self, text: str) -> float:
        """計算概念數量 (0-1)"""
        if not text:
            return 0.3
        
        # 簡化：計算專有名詞/縮寫數量
        abbreviations = len(re.findall(r'\b[A-Z]{2,}\b', text))
        proper_nouns = len(re.findall(r'\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b', text))
        
        concept_score = (abbreviations * 0.1 + proper_nouns * 0.05)
        return min(concept_score, 1.0)
    
    def _calc_depth(self, text: str):
        if not text:
            return 0.3
        #original -> float:
        """計算計算深度 (0-1)"""
        text_lower = text.lower()
        
        # 檢查計算關鍵詞
        calc_count = sum(1 for kw in self.CALC_KEYWORDS if kw in text_lower)
        
        # 檢查數字
        numbers = len(re.findall(r'\d+', text))
        
        # 檢查數學符號
        math_symbols = len(re.findall(r'[+\-*/=<>%]', text))
        
        depth = (calc_count * 0.15 + numbers * 0.02 + math_symbols * 0.05)
        return min(depth, 1.0)
    
    def _calc_scenario_complexity(self, text: str) -> float:
        """計算情境複雜度 (0-1)"""
        if not text:
            return 0.3
        
        score = 0.0
        
        # 角色/實體數量
        entities = len(re.findall(r'公司|企業|客戶|用戶|團隊|部門|company|team|user|client', 
                                 text, re.IGNORECASE))
        score += min(entities * 0.1, 0.3)
        
        # 條件語句
        conditions = len(re.findall(r'如果|若|當|假設|if|when|given|assuming', 
                                   text, re.IGNORECASE))
        score += min(conditions * 0.15, 0.3)
        
        # 多步驟
        steps = len(re.findall(r'首先|然後|接著|最後|first|then|next|finally', 
                              text, re.IGNORECASE))
        score += min(steps * 0.1, 0.2)
        
        # 要求/限制
        requirements = len(re.findall(r'必須|需要|要求|限制|must|need|require|constraint', 
                                     text, re.IGNORECASE))
        score += min(requirements * 0.1, 0.2)
        
        return min(score, 1.0)
    
    def calculate_difficulty(self, factors: DifficultyFactors) -> int:
        """計算最終難度 (1-5)"""
        weighted_score = (
            factors.text_complexity * self.WEIGHTS['text_complexity'] +
            factors.option_similarity * self.WEIGHTS['option_similarity'] +
            factors.concept_count * self.WEIGHTS['concept_count'] +
            factors.calculation_depth * self.WEIGHTS['calculation_depth'] +
            factors.scenario_complexity * self.WEIGHTS['scenario_complexity']
        )
        
        # 映射到 1-5
        if weighted_score < 0.2:
            return 1
        elif weighted_score < 0.35:
            return 2
        elif weighted_score < 0.5:
            return 3
        elif weighted_score < 0.7:
            return 4
        else:
            return 5
    
    def calibrate_question(self, question_id: str, question_text: str,
                          options: str = None, scenario: str = None,
                          current_difficulty: int = None) -> Dict:
        """校準單題難度"""
        # 解析選項
        opts = None
        if options:
            try:
                opts = json.loads(options) if isinstance(options, str) else options
            except:
                pass
        
        # 分析因子
        factors = self.analyze_question(question_text, opts, scenario)
        
        # 計算難度
        calculated = self.calculate_difficulty(factors)
        
        # 與當前難度比較
        needs_update = current_difficulty is None or abs(calculated - current_difficulty) >= 2
        
        return {
            'question_id': question_id,
            'factors': factors,
            'calculated_difficulty': calculated,
            'current_difficulty': current_difficulty,
            'needs_update': needs_update,
            'change': calculated - (current_difficulty or 3)
        }
    
    def batch_calibrate(self, cert_id: str = None, update: bool = False,
                       limit: int = None) -> Dict:
        """批次校準"""
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        sql = '''
            SELECT question_id, question_text, options, scenario, difficulty
            FROM ai_cert_questions_v2 WHERE 1=1
        '''
        if cert_id:
            sql += f" AND cert_id = '{cert_id}'"
        if limit:
            sql += f" LIMIT {limit}"
        
        cur.execute(sql)
        questions = cur.fetchall()
        
        results = {
            'processed': 0,
            'needs_update': 0,
            'updated': 0,
            'distribution_before': defaultdict(int),
            'distribution_after': defaultdict(int)
        }
        
        for q_id, q_text, opts, scenario, curr_diff in questions:
            results['distribution_before'][curr_diff or 3] += 1
            
            cal_result = self.calibrate_question(q_id, q_text, opts, scenario, curr_diff)
            results['distribution_after'][cal_result['calculated_difficulty']] += 1
            
            if cal_result['needs_update']:
                results['needs_update'] += 1
                
                if update:
                    cur.execute('''
                        UPDATE ai_cert_questions_v2 
                        SET difficulty = ? WHERE question_id = ?
                    ''', (cal_result['calculated_difficulty'], q_id))
                    results['updated'] += 1
            
            results['processed'] += 1
        
        if update:
            conn.commit()
        conn.close()
        
        return results
    
    def get_distribution_report(self) -> Dict:
        """獲取難度分布報告"""
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        report = {'ai_cert': {}, 'ipas': {}, 'recommendations': []}
        
        # AI 認證
        cur.execute('''
            SELECT cert_id, difficulty, COUNT(*) 
            FROM ai_cert_questions_v2 
            GROUP BY cert_id, difficulty
            ORDER BY cert_id, difficulty
        ''')
        
        for cert_id, diff, count in cur.fetchall():
            if cert_id not in report['ai_cert']:
                report['ai_cert'][cert_id] = {}
            report['ai_cert'][cert_id][diff or 3] = count
        
        # IPAS
        cur.execute('''
            SELECT difficulty, COUNT(*) 
            FROM ipas_ise_questions 
            GROUP BY difficulty
        ''')
        for diff, count in cur.fetchall():
            report['ipas'][diff or 3] = count
        
        conn.close()
        
        # 建議
        for cert_id, dist in report['ai_cert'].items():
            total = sum(dist.values())
            if total > 0:
                l3_ratio = dist.get(3, 0) / total
                if l3_ratio > 0.5:
                    report['recommendations'].append(
                        f"{cert_id}: 難度3過於集中({l3_ratio:.0%})，建議重新校準"
                    )
        
        return report

# ============================================================
# 測試
# ============================================================

if __name__ == "__main__":
    print("=" * 50)
    print("難度智能校準系統 R12 測試")
    print("=" * 50)
    
    calibrator = DifficultyCalibrator('/home/claude/education_v52.db')
    
    # 測試單題
    test_q = """A company needs to implement a machine learning solution 
    that can automatically scale based on inference demand while maintaining 
    low latency. The solution must comply with HIPAA regulations. 
    Which AWS service combination should they use?"""
    
    factors = calibrator.analyze_question(test_q)
    difficulty = calibrator.calculate_difficulty(factors)
    
    print(f"\n測試題目: {test_q[:60]}...")
    print(f"文本複雜度: {factors.text_complexity:.2f}")
    print(f"概念數量: {factors.concept_count:.2f}")
    print(f"情境複雜度: {factors.scenario_complexity:.2f}")
    print(f"計算難度: {difficulty}")
    
    # 批次分析（不更新）
    print("\n批次分析...")
    result = calibrator.batch_calibrate(limit=200, update=False)
    print(f"  處理: {result['processed']} 題")
    print(f"  需更新: {result['needs_update']} 題")
    print(f"  分布(前): {dict(result['distribution_before'])}")
    print(f"  分布(後): {dict(result['distribution_after'])}")
    
    print("\n✅ R12 難度智能校準系統完成")
