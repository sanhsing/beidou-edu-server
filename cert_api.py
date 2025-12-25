#!/usr/bin/env python3
"""
北斗教育 認證系統 API
v53 新增: 8 端點

支援認證:
- Google AI Essentials
- AWS AI Practitioner  
- Microsoft AI-900
- IPAS 資訊安全工程師
"""

from flask import Blueprint, request, jsonify
import sqlite3
import os
import random
from datetime import datetime

cert_bp = Blueprint('cert', __name__, url_prefix='/api/cert')

DB_PATH = os.environ.get('DB_PATH', './education_v53.db')

def api_response(data=None, error=None, status=200):
    if error:
        return jsonify({'success': False, 'error': error}), status
    return jsonify({'success': True, 'data': data}), status

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

# ============================================================
# 1. GET /api/cert/list - 認證列表
# ============================================================

@cert_bp.route('/list', methods=['GET'])
def get_cert_list():
    """取得所有認證課程列表"""
    conn = get_db()
    cur = conn.cursor()
    
    cur.execute('''
        SELECT cert_key, name, description, duration_weeks, difficulty
        FROM cert_learning_paths_v2
    ''')
    certs = [dict(row) for row in cur.fetchall()]
    
    # 補充統計
    for cert in certs:
        # 術語數
        cur.execute('''
            SELECT COUNT(*) FROM cert_glossary_v2 
            WHERE certification = ?
        ''', (cert['cert_key'],))
        cert['term_count'] = cur.fetchone()[0]
        
        # 主題數
        cur.execute('''
            SELECT COUNT(*) FROM cert_domain_topics 
            WHERE cert_key = ?
        ''', (cert['cert_key'],))
        cert['topic_count'] = cur.fetchone()[0]
        
        # 題庫數 (從 ai_certification_questions)
        cur.execute('''
            SELECT COUNT(*) FROM ai_certification_questions 
            WHERE certification LIKE ?
        ''', (f'%{cert["cert_key"]}%',))
        cert['question_count'] = cur.fetchone()[0]
    
    conn.close()
    return api_response(certs)

# ============================================================
# 2. GET /api/cert/:key/path - 學習路徑
# ============================================================

@cert_bp.route('/<cert_key>/path', methods=['GET'])
def get_cert_path(cert_key):
    """取得認證學習路徑"""
    conn = get_db()
    cur = conn.cursor()
    
    # 認證資訊
    cur.execute('''
        SELECT * FROM cert_learning_paths_v2 WHERE cert_key = ?
    ''', (cert_key,))
    cert = cur.fetchone()
    
    if not cert:
        conn.close()
        return api_response(error='Certification not found', status=404)
    
    # 學習主題 (按領域分組)
    cur.execute('''
        SELECT domain, topic, order_num 
        FROM cert_domain_topics 
        WHERE cert_key = ?
        ORDER BY order_num, id
    ''', (cert_key,))
    
    domains = {}
    for row in cur.fetchall():
        domain = row['domain']
        if domain not in domains:
            domains[domain] = {'name': domain, 'topics': []}
        domains[domain]['topics'].append(row['topic'])
    
    conn.close()
    
    return api_response({
        'cert': dict(cert),
        'domains': list(domains.values())
    })

# ============================================================
# 3. GET /api/cert/:key/glossary - 術語列表
# ============================================================

@cert_bp.route('/<cert_key>/glossary', methods=['GET'])
def get_cert_glossary(cert_key):
    """取得認證術語列表"""
    conn = get_db()
    cur = conn.cursor()
    
    page = request.args.get('page', 1, type=int)
    limit = request.args.get('limit', 50, type=int)
    offset = (page - 1) * limit
    
    cur.execute('''
        SELECT id, term, term_zh, definition, category
        FROM cert_glossary_v2
        WHERE certification = ?
        LIMIT ? OFFSET ?
    ''', (cert_key, limit, offset))
    terms = [dict(row) for row in cur.fetchall()]
    
    cur.execute('''
        SELECT COUNT(*) FROM cert_glossary_v2 WHERE certification = ?
    ''', (cert_key,))
    total = cur.fetchone()[0]
    
    conn.close()
    
    return api_response({
        'terms': terms,
        'pagination': {
            'page': page,
            'limit': limit,
            'total': total,
            'pages': (total + limit - 1) // limit
        }
    })

# ============================================================
# 4. GET /api/cert/glossary/search - 術語搜尋
# ============================================================

@cert_bp.route('/glossary/search', methods=['GET'])
def search_glossary():
    """搜尋術語"""
    q = request.args.get('q', '')
    cert_key = request.args.get('cert', None)
    limit = request.args.get('limit', 20, type=int)
    
    if len(q) < 2:
        return api_response(error='Query too short (min 2 chars)', status=400)
    
    conn = get_db()
    cur = conn.cursor()
    
    if cert_key:
        cur.execute('''
            SELECT id, certification, term, term_zh, definition
            FROM cert_glossary_v2
            WHERE certification = ? 
              AND (term LIKE ? OR term_zh LIKE ? OR definition LIKE ?)
            LIMIT ?
        ''', (cert_key, f'%{q}%', f'%{q}%', f'%{q}%', limit))
    else:
        cur.execute('''
            SELECT id, certification, term, term_zh, definition
            FROM cert_glossary_v2
            WHERE term LIKE ? OR term_zh LIKE ? OR definition LIKE ?
            LIMIT ?
        ''', (f'%{q}%', f'%{q}%', f'%{q}%', limit))
    
    results = [dict(row) for row in cur.fetchall()]
    conn.close()
    
    return api_response({
        'query': q,
        'count': len(results),
        'results': results
    })

# ============================================================
# 5. POST /api/cert/progress - 更新學習進度
# ============================================================

@cert_bp.route('/progress', methods=['POST'])
def update_progress():
    """更新學習進度"""
    data = request.get_json()
    user_id = data.get('user_id')
    cert_key = data.get('cert_key')
    topic_id = data.get('topic_id')
    status = data.get('status', 'completed')  # not_started, in_progress, completed
    score = data.get('score')
    
    if not user_id or not cert_key:
        return api_response(error='Missing user_id or cert_key', status=400)
    
    conn = get_db()
    cur = conn.cursor()
    
    cur.execute('''
        INSERT OR REPLACE INTO cert_user_progress 
        (user_id, cert_key, topic_id, status, score, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
    ''', (user_id, cert_key, topic_id, status, score, datetime.now().isoformat()))
    
    conn.commit()
    conn.close()
    
    return api_response({'updated': True})

# ============================================================
# 6. GET /api/cert/progress/:uid - 查詢學習進度
# ============================================================

@cert_bp.route('/progress/<int:user_id>', methods=['GET'])
def get_progress(user_id):
    """取得使用者學習進度"""
    cert_key = request.args.get('cert', None)
    
    conn = get_db()
    cur = conn.cursor()
    
    if cert_key:
        cur.execute('''
            SELECT * FROM cert_user_progress
            WHERE user_id = ? AND cert_key = ?
        ''', (user_id, cert_key))
    else:
        cur.execute('''
            SELECT * FROM cert_user_progress WHERE user_id = ?
        ''', (user_id,))
    
    progress = [dict(row) for row in cur.fetchall()]
    
    # 統計
    stats = {}
    for p in progress:
        ck = p['cert_key']
        if ck not in stats:
            stats[ck] = {'total': 0, 'completed': 0}
        stats[ck]['total'] += 1
        if p['status'] == 'completed':
            stats[ck]['completed'] += 1
    
    conn.close()
    
    return api_response({
        'user_id': user_id,
        'progress': progress,
        'stats': stats
    })

# ============================================================
# 7. POST /api/cert/exam/start - 開始模擬考
# ============================================================

@cert_bp.route('/exam/start', methods=['POST'])
def start_exam():
    """開始模擬考"""
    data = request.get_json()
    user_id = data.get('user_id')
    cert_key = data.get('cert_key')
    question_count = data.get('count', 20)
    
    if not user_id or not cert_key:
        return api_response(error='Missing user_id or cert_key', status=400)
    
    conn = get_db()
    cur = conn.cursor()
    
    # 隨機抽題
    cur.execute('''
        SELECT id, question, options, answer, explanation, difficulty
        FROM ai_certification_questions
        WHERE certification LIKE ?
        ORDER BY RANDOM()
        LIMIT ?
    ''', (f'%{cert_key}%', question_count))
    
    questions = []
    for row in cur.fetchall():
        q = dict(row)
        # 隱藏答案
        q['answer'] = None
        q['explanation'] = None
        questions.append(q)
    
    if not questions:
        conn.close()
        return api_response(error='No questions available', status=404)
    
    # 建立考試記錄
    session_id = f"exam_{user_id}_{cert_key}_{int(datetime.now().timestamp())}"
    cur.execute('''
        INSERT INTO cert_exam_sessions 
        (user_id, cert_key, total_questions, started_at)
        VALUES (?, ?, ?, ?)
    ''', (user_id, cert_key, len(questions), datetime.now().isoformat()))
    
    exam_id = cur.lastrowid
    conn.commit()
    conn.close()
    
    return api_response({
        'exam_id': exam_id,
        'cert_key': cert_key,
        'question_count': len(questions),
        'questions': questions,
        'time_limit': question_count * 90  # 每題 90 秒
    })

# ============================================================
# 8. POST /api/cert/exam/submit - 提交答案
# ============================================================

@cert_bp.route('/exam/submit', methods=['POST'])
def submit_exam():
    """提交模擬考答案"""
    data = request.get_json()
    exam_id = data.get('exam_id')
    answers = data.get('answers', {})  # {question_id: selected_answer}
    
    if not exam_id:
        return api_response(error='Missing exam_id', status=400)
    
    conn = get_db()
    cur = conn.cursor()
    
    # 取得考試資訊
    cur.execute('SELECT * FROM cert_exam_sessions WHERE id = ?', (exam_id,))
    exam = cur.fetchone()
    
    if not exam:
        conn.close()
        return api_response(error='Exam not found', status=404)
    
    # 計算成績
    correct = 0
    results = []
    
    for qid_str, user_answer in answers.items():
        qid = int(qid_str)
        cur.execute('''
            SELECT id, question, answer, explanation 
            FROM ai_certification_questions WHERE id = ?
        ''', (qid,))
        q = cur.fetchone()
        
        if q:
            is_correct = (user_answer == q['answer'])
            if is_correct:
                correct += 1
            results.append({
                'question_id': qid,
                'user_answer': user_answer,
                'correct_answer': q['answer'],
                'is_correct': is_correct,
                'explanation': q['explanation']
            })
    
    total = len(answers)
    score = round(100 * correct / total, 1) if total > 0 else 0
    
    # 更新考試記錄
    cur.execute('''
        UPDATE cert_exam_sessions 
        SET correct_count = ?, score = ?, ended_at = ?
        WHERE id = ?
    ''', (correct, score, datetime.now().isoformat(), exam_id))
    
    conn.commit()
    conn.close()
    
    return api_response({
        'exam_id': exam_id,
        'total': total,
        'correct': correct,
        'score': score,
        'passed': score >= 70,
        'results': results
    })

# ============================================================
# 註冊到主 app
# ============================================================

def register_cert_routes(app):
    """註冊認證系統路由"""
    app.register_blueprint(cert_bp)
    print("✓ Cert API 已註冊 (8 端點)")

