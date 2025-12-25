"""
題目關聯圖譜引擎
理科線產出 R14

功能：
1. 建立題目之間的關聯關係
2. 識別相似題/進階題/前置題
3. 生成學習路徑建議
"""

import sqlite3
import json
import re
from typing import Dict, List, Set, Tuple, Optional
from dataclasses import dataclass, field
from collections import defaultdict
from enum import Enum
import math

class RelationType(Enum):
    """關係類型"""
    SIMILAR = 'similar'           # 相似題
    PREREQUISITE = 'prerequisite' # 前置題
    ADVANCED = 'advanced'         # 進階題
    SAME_CONCEPT = 'same_concept' # 同概念
    COMPLEMENT = 'complement'     # 互補題

@dataclass
class QuestionNode:
    """題目節點"""
    question_id: str
    cert_id: str
    domain_id: str
    difficulty: int
    tags: List[str]
    text_hash: str = ""

@dataclass
class QuestionEdge:
    """題目關係邊"""
    source_id: str
    target_id: str
    relation_type: RelationType
    weight: float  # 關聯強度 0-1
    reason: str = ""

class QuestionGraphEngine:
    """題目關聯圖譜引擎"""
    
    def __init__(self, db_path: str):
        self.db_path = db_path
        self.nodes: Dict[str, QuestionNode] = {}
        self.edges: List[QuestionEdge] = []
        self.tag_index: Dict[str, Set[str]] = defaultdict(set)
        self.domain_index: Dict[str, Set[str]] = defaultdict(set)
        self._ensure_tables()
    
    def _ensure_tables(self):
        """確保關聯表存在"""
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        cur.execute('''
            CREATE TABLE IF NOT EXISTS question_relationships (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_id TEXT,
                target_id TEXT,
                relation_type TEXT,
                weight REAL,
                reason TEXT,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(source_id, target_id, relation_type)
            )
        ''')
        
        cur.execute('CREATE INDEX IF NOT EXISTS idx_qr_source ON question_relationships(source_id)')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_qr_target ON question_relationships(target_id)')
        cur.execute('CREATE INDEX IF NOT EXISTS idx_qr_type ON question_relationships(relation_type)')
        
        conn.commit()
        conn.close()
    
    def load_questions(self, cert_id: str = None, limit: int = None):
        """載入題目建立節點"""
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        sql = '''
            SELECT question_id, cert_id, domain_id, difficulty, tags, question_text
            FROM ai_cert_questions_v2 WHERE 1=1
        '''
        if cert_id:
            sql += f" AND cert_id = '{cert_id}'"
        if limit:
            sql += f" LIMIT {limit}"
        
        cur.execute(sql)
        
        for row in cur.fetchall():
            q_id, c_id, d_id, diff, tags_json, text = row
            
            tags = []
            if tags_json:
                try:
                    tags = json.loads(tags_json)
                except:
                    pass
            
            # 建立節點
            node = QuestionNode(
                question_id=q_id,
                cert_id=c_id,
                domain_id=d_id or '',
                difficulty=diff or 3,
                tags=tags,
                text_hash=self._simple_hash(text or '')
            )
            
            self.nodes[q_id] = node
            
            # 建立索引
            for tag in tags:
                self.tag_index[tag.lower()].add(q_id)
            
            if d_id:
                self.domain_index[d_id].add(q_id)
        
        conn.close()
        print(f"載入 {len(self.nodes)} 個題目節點")
    
    def _simple_hash(self, text: str) -> str:
        """簡單文本哈希（用於相似度比較）"""
        # 提取關鍵詞
        words = re.findall(r'\b\w{4,}\b', text.lower())
        return ' '.join(sorted(set(words[:20])))
    
    def build_relationships(self):
        """建立題目關係"""
        print("建立題目關係...")
        
        # 1. 基於標籤的相似關係
        self._build_tag_similarity()
        
        # 2. 基於難度的前置/進階關係
        self._build_difficulty_chain()
        
        # 3. 基於領域的同概念關係
        self._build_domain_relations()
        
        print(f"建立 {len(self.edges)} 條關係邊")
    
    def _build_tag_similarity(self):
        """基於標籤建立相似關係"""
        # 對每對共享標籤的題目建立關係
        processed = set()
        
        for tag, q_ids in self.tag_index.items():
            q_list = list(q_ids)
            for i, q1 in enumerate(q_list):
                for q2 in q_list[i+1:]:
                    pair = tuple(sorted([q1, q2]))
                    if pair in processed:
                        continue
                    processed.add(pair)
                    
                    # 計算標籤重疊度
                    node1 = self.nodes[q1]
                    node2 = self.nodes[q2]
                    
                    tags1 = set(t.lower() for t in node1.tags)
                    tags2 = set(t.lower() for t in node2.tags)
                    
                    if not tags1 or not tags2:
                        continue
                    
                    overlap = len(tags1 & tags2)
                    union = len(tags1 | tags2)
                    jaccard = overlap / union if union > 0 else 0
                    
                    if jaccard >= 0.3:  # 閾值
                        self.edges.append(QuestionEdge(
                            source_id=q1,
                            target_id=q2,
                            relation_type=RelationType.SIMILAR,
                            weight=jaccard,
                            reason=f"共享標籤: {', '.join(tags1 & tags2)}"
                        ))
    
    def _build_difficulty_chain(self):
        """基於難度建立前置/進階關係"""
        # 在同領域內，低難度題是高難度題的前置
        for domain, q_ids in self.domain_index.items():
            if len(q_ids) < 2:
                continue
            
            # 按難度分組
            by_diff = defaultdict(list)
            for q_id in q_ids:
                node = self.nodes[q_id]
                by_diff[node.difficulty].append(q_id)
            
            # 建立難度階梯關係
            diffs = sorted(by_diff.keys())
            for i, d1 in enumerate(diffs[:-1]):
                d2 = diffs[i + 1]
                
                # 低難度 → 高難度 (前置關係)
                for q1 in by_diff[d1][:5]:  # 限制數量
                    for q2 in by_diff[d2][:5]:
                        # 檢查是否有共同標籤
                        tags1 = set(self.nodes[q1].tags)
                        tags2 = set(self.nodes[q2].tags)
                        
                        if tags1 & tags2:  # 有共同標籤才建立關係
                            self.edges.append(QuestionEdge(
                                source_id=q1,
                                target_id=q2,
                                relation_type=RelationType.PREREQUISITE,
                                weight=0.7,
                                reason=f"難度遞進: {d1}→{d2}"
                            ))
    
    def _build_domain_relations(self):
        """基於領域建立同概念關係"""
        processed = set()
        
        for domain, q_ids in self.domain_index.items():
            q_list = list(q_ids)[:50]  # 限制
            
            for i, q1 in enumerate(q_list):
                for q2 in q_list[i+1:]:
                    pair = tuple(sorted([q1, q2]))
                    if pair in processed:
                        continue
                    
                    node1 = self.nodes[q1]
                    node2 = self.nodes[q2]
                    
                    # 同難度、同領域 = 同概念
                    if node1.difficulty == node2.difficulty:
                        # 檢查文本相似度
                        hash_overlap = len(set(node1.text_hash.split()) & 
                                          set(node2.text_hash.split()))
                        
                        if hash_overlap >= 3:
                            processed.add(pair)
                            self.edges.append(QuestionEdge(
                                source_id=q1,
                                target_id=q2,
                                relation_type=RelationType.SAME_CONCEPT,
                                weight=0.6,
                                reason=f"同領域同難度: {domain}"
                            ))
    
    def save_relationships(self):
        """保存關係到資料庫"""
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        count = 0
        for edge in self.edges:
            try:
                cur.execute('''
                    INSERT OR IGNORE INTO question_relationships
                    (source_id, target_id, relation_type, weight, reason)
                    VALUES (?, ?, ?, ?, ?)
                ''', (edge.source_id, edge.target_id, edge.relation_type.value,
                      edge.weight, edge.reason))
                count += 1
            except:
                pass
        
        conn.commit()
        conn.close()
        
        print(f"保存 {count} 條關係到資料庫")
    
    def get_related_questions(self, question_id: str, 
                             relation_type: RelationType = None,
                             limit: int = 10) -> List[Dict]:
        """獲取相關題目"""
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        sql = '''
            SELECT target_id, relation_type, weight, reason
            FROM question_relationships
            WHERE source_id = ?
        '''
        params = [question_id]
        
        if relation_type:
            sql += ' AND relation_type = ?'
            params.append(relation_type.value)
        
        sql += ' ORDER BY weight DESC LIMIT ?'
        params.append(limit)
        
        cur.execute(sql, params)
        
        results = []
        for row in cur.fetchall():
            results.append({
                'question_id': row[0],
                'relation_type': row[1],
                'weight': row[2],
                'reason': row[3]
            })
        
        conn.close()
        return results
    
    def get_learning_path(self, start_question_id: str, 
                         target_difficulty: int = 5) -> List[str]:
        """生成學習路徑"""
        path = [start_question_id]
        current = start_question_id
        visited = {start_question_id}
        
        while len(path) < 10:
            # 找前置關係的進階題
            related = self.get_related_questions(
                current, 
                relation_type=RelationType.PREREQUISITE,
                limit=5
            )
            
            # 也檢查反向關係
            conn = sqlite3.connect(self.db_path)
            cur = conn.cursor()
            cur.execute('''
                SELECT source_id, weight FROM question_relationships
                WHERE target_id = ? AND relation_type = 'prerequisite'
                ORDER BY weight DESC LIMIT 5
            ''', (current,))
            prereqs = cur.fetchall()
            conn.close()
            
            # 選擇下一題
            next_q = None
            for r in related:
                if r['question_id'] not in visited:
                    next_q = r['question_id']
                    break
            
            if not next_q:
                break
            
            path.append(next_q)
            visited.add(next_q)
            current = next_q
        
        return path
    
    def get_graph_stats(self) -> Dict:
        """獲取圖譜統計"""
        conn = sqlite3.connect(self.db_path)
        cur = conn.cursor()
        
        cur.execute("SELECT COUNT(*) FROM question_relationships")
        total_edges = cur.fetchone()[0]
        
        cur.execute('''
            SELECT relation_type, COUNT(*), AVG(weight)
            FROM question_relationships
            GROUP BY relation_type
        ''')
        
        by_type = {}
        for row in cur.fetchall():
            by_type[row[0]] = {'count': row[1], 'avg_weight': round(row[2], 2)}
        
        cur.execute("SELECT COUNT(DISTINCT source_id) FROM question_relationships")
        connected_nodes = cur.fetchone()[0]
        
        conn.close()
        
        return {
            'total_edges': total_edges,
            'by_type': by_type,
            'connected_nodes': connected_nodes,
            'isolated_nodes': len(self.nodes) - connected_nodes if self.nodes else 0
        }

# ============================================================
# 測試
# ============================================================

if __name__ == "__main__":
    print("=" * 55)
    print("題目關聯圖譜引擎 R14 測試")
    print("=" * 55)
    
    engine = QuestionGraphEngine('/home/claude/education_v53.db')
    
    # 載入題目
    engine.load_questions(limit=500)
    
    # 建立關係
    engine.build_relationships()
    
    # 保存
    engine.save_relationships()
    
    # 統計
    stats = engine.get_graph_stats()
    print(f"\n圖譜統計:")
    print(f"  總邊數: {stats['total_edges']}")
    print(f"  關聯類型: {stats['by_type']}")
    print(f"  已連接節點: {stats['connected_nodes']}")
    
    print("\n✅ R14 題目關聯圖譜引擎完成")
