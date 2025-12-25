"""
題目-術語自動關聯引擎
理科線產出 R11

功能：
1. 自動識別題目中的術語
2. 建立題目-術語關聯
3. 生成術語標籤
"""

import sqlite3
import json
import re
from typing import Dict, List, Set, Tuple
from dataclasses import dataclass
from collections import defaultdict

@dataclass
class TermMatch:
    """術語匹配結果"""
    term: str
    term_zh: str
    term_en: str
    position: int
    confidence: float

class TermLinker:
    """題目-術語關聯引擎"""
    
    def __init__(self, db_path: str):
        self.db_path = db_path
        self.term_index: Dict[str, List[Dict]] = defaultdict(list)
        self._build_index()
    
    def _build_index(self):
        """建立術語索引"""
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        # 從 cert_glossary_v2 載入術語
        cur.execute('''
            SELECT cert_id, term, term_zh, term_en, definition
            FROM cert_glossary_v2
        ''')
        
        for row in cur.fetchall():
            cert_id, term, term_zh, term_en, definition = row
            
            # 建立多種索引形式
            term_data = {
                'cert_id': cert_id,
                'term': term,
                'term_zh': term_zh or term,
                'term_en': term_en or term,
                'definition': definition
            }
            
            # 原始術語
            if term:
                self.term_index[term.lower()].append(term_data)
            
            # 中文術語
            if term_zh and term_zh != term:
                self.term_index[term_zh.lower()].append(term_data)
            
            # 英文術語
            if term_en and term_en != term:
                self.term_index[term_en.lower()].append(term_data)
        
        conn.close()
        print(f"術語索引建立完成: {len(self.term_index)} 個索引項")
    
    def find_terms(self, text: str, cert_id: str = None) -> List[TermMatch]:
        """在文本中尋找術語"""
        if not text:
            return []
        
        matches = []
        text_lower = text.lower()
        
        # 按術語長度排序（優先匹配長術語）
        sorted_terms = sorted(self.term_index.keys(), key=len, reverse=True)
        
        matched_positions = set()  # 避免重疊匹配
        
        for term_key in sorted_terms:
            # 尋找所有出現位置
            start = 0
            while True:
                pos = text_lower.find(term_key, start)
                if pos == -1:
                    break
                
                # 檢查是否與已匹配位置重疊
                term_range = set(range(pos, pos + len(term_key)))
                if not term_range & matched_positions:
                    # 獲取術語資料
                    term_data_list = self.term_index[term_key]
                    
                    # 如果指定了認證，優先匹配該認證的術語
                    if cert_id:
                        cert_matches = [t for t in term_data_list if t['cert_id'] == cert_id]
                        if cert_matches:
                            term_data_list = cert_matches
                    
                    if term_data_list:
                        term_data = term_data_list[0]
                        
                        # 計算信心度
                        confidence = self._calc_confidence(term_key, text, pos)
                        
                        matches.append(TermMatch(
                            term=term_data['term'],
                            term_zh=term_data['term_zh'],
                            term_en=term_data['term_en'],
                            position=pos,
                            confidence=confidence
                        ))
                        
                        matched_positions.update(term_range)
                
                start = pos + 1
        
        # 按位置排序
        matches.sort(key=lambda x: x.position)
        return matches
    
    def _calc_confidence(self, term: str, text: str, pos: int) -> float:
        """計算匹配信心度"""
        confidence = 0.5  # 基礎分
        
        # 完整詞匹配加分
        before = text[pos-1] if pos > 0 else ' '
        after = text[pos+len(term)] if pos+len(term) < len(text) else ' '
        
        if not before.isalnum() and not after.isalnum():
            confidence += 0.3  # 完整詞
        
        # 長術語加分
        if len(term) > 10:
            confidence += 0.1
        
        # 大寫/專有名詞加分
        if term[0].isupper():
            confidence += 0.1
        
        return min(confidence, 1.0)
    
    def link_question(self, question_id: str, question_text: str, 
                     cert_id: str, options: str = None) -> Dict:
        """為單一題目建立術語關聯"""
        # 合併題目文本和選項
        full_text = question_text
        if options:
            try:
                opts = json.loads(options) if isinstance(options, str) else options
                full_text += ' ' + ' '.join(str(o) for o in opts)
            except:
                pass
        
        # 尋找術語
        matches = self.find_terms(full_text, cert_id)
        
        # 生成標籤
        tags = list(set(m.term for m in matches if m.confidence >= 0.5))
        
        return {
            'question_id': question_id,
            'matches': matches,
            'tags': tags,
            'tag_count': len(tags)
        }
    
    def batch_link(self, cert_id: str = None, limit: int = None) -> Dict:
        """批次處理題目關聯"""
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        # 獲取需要處理的題目
        sql = '''
            SELECT question_id, cert_id, question_text, options
            FROM ai_cert_questions_v2
            WHERE tags IS NULL OR tags = '' OR tags = '[]'
        '''
        if cert_id:
            sql += f" AND cert_id = '{cert_id}'"
        if limit:
            sql += f" LIMIT {limit}"
        
        cur.execute(sql)
        questions = cur.fetchall()
        
        results = {
            'processed': 0,
            'linked': 0,
            'total_tags': 0,
            'by_cert': defaultdict(int)
        }
        
        for q_id, c_id, q_text, opts in questions:
            link_result = self.link_question(q_id, q_text, c_id, opts)
            
            if link_result['tags']:
                # 更新資料庫
                cur.execute('''
                    UPDATE ai_cert_questions_v2 
                    SET tags = ? 
                    WHERE question_id = ?
                ''', (json.dumps(link_result['tags']), q_id))
                
                results['linked'] += 1
                results['total_tags'] += link_result['tag_count']
                results['by_cert'][c_id] += 1
            
            results['processed'] += 1
        
        conn.commit()
        conn.close()
        
        return results
    
    def link_ipas(self, limit: int = None) -> Dict:
        """處理 IPAS 題目"""
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        # 檢查是否有 tags 欄位
        cur.execute("PRAGMA table_info(ipas_ise_questions)")
        columns = [col[1] for col in cur.fetchall()]
        
        if 'tags' not in columns:
            cur.execute('ALTER TABLE ipas_ise_questions ADD COLUMN tags TEXT')
            conn.commit()
        
        sql = 'SELECT question_id, question_text, options FROM ipas_ise_questions'
        if limit:
            sql += f' LIMIT {limit}'
        
        cur.execute(sql)
        questions = cur.fetchall()
        
        results = {'processed': 0, 'linked': 0, 'total_tags': 0}
        
        for q_id, q_text, opts in questions:
            link_result = self.link_question(q_id, q_text, 'IPAS_ISE', opts)
            
            if link_result['tags']:
                cur.execute('''
                    UPDATE ipas_ise_questions SET tags = ? WHERE question_id = ?
                ''', (json.dumps(link_result['tags']), q_id))
                
                results['linked'] += 1
                results['total_tags'] += link_result['tag_count']
            
            results['processed'] += 1
        
        conn.commit()
        conn.close()
        
        return results
    
    def get_term_stats(self) -> Dict:
        """獲取術語統計"""
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        # 統計每個術語被關聯的次數
        cur.execute('''
            SELECT tags FROM ai_cert_questions_v2 
            WHERE tags IS NOT NULL AND tags != '' AND tags != '[]'
        ''')
        
        term_counts = defaultdict(int)
        for (tags_json,) in cur.fetchall():
            try:
                tags = json.loads(tags_json)
                for tag in tags:
                    term_counts[tag] += 1
            except:
                pass
        
        conn.close()
        
        # 排序
        sorted_terms = sorted(term_counts.items(), key=lambda x: -x[1])
        
        return {
            'total_unique_terms': len(term_counts),
            'top_terms': sorted_terms[:20],
            'unused_terms': [t for t in self.term_index.keys() 
                           if t not in term_counts][:20]
        }

# ============================================================
# 測試
# ============================================================

if __name__ == "__main__":
    print("=" * 50)
    print("題目-術語自動關聯引擎 R11 測試")
    print("=" * 50)
    
    linker = TermLinker('/home/claude/education_v52.db')
    
    # 測試單題
    test_text = "Machine Learning is a subset of AI that enables computers to learn from data."
    matches = linker.find_terms(test_text)
    print(f"\n測試文本: {test_text[:50]}...")
    print(f"找到術語: {[m.term for m in matches]}")
    
    # 批次處理 AI 認證
    print("\n批次處理 AI 認證題目...")
    result = linker.batch_link(limit=500)
    print(f"  處理: {result['processed']} 題")
    print(f"  關聯: {result['linked']} 題")
    print(f"  標籤: {result['total_tags']} 個")
    
    # 處理 IPAS
    print("\n處理 IPAS 題目...")
    ipas_result = linker.link_ipas(limit=200)
    print(f"  處理: {ipas_result['processed']} 題")
    print(f"  關聯: {ipas_result['linked']} 題")
    
    print("\n✅ R11 題目-術語自動關聯引擎完成")
