#!/usr/bin/env python3
"""
gsat_questions_api.py - GSAT 題庫查詢 API
北斗教育 v57 補丁

新增端點:
- GET /api/gsat/questions - 從 gsat_dedup_questions 取題
- GET /api/gsat/subjects - 列出所有科目

用法: 在 backend_v53.py 中 import 並註冊
"""

from flask import Blueprint, request, jsonify
import sqlite3
import json
import os

gsat_questions_bp = Blueprint('gsat_questions', __name__)

DB_PATH = os.environ.get('DB_PATH', './education.db')

def get_db():
    return sqlite3.connect(DB_PATH)

@gsat_questions_bp.route('/api/gsat/questions', methods=['GET'])
def get_gsat_questions():
    """
    從 gsat_dedup_questions 取題目
    
    參數:
    - subject: 科目名稱 (物理/化學/數學/...)
    - count: 題數 (預設10)
    - difficulty: 難度 1-5 (可選)
    """
    subject = request.args.get('subject', '')
    count = int(request.args.get('count', 10))
    difficulty = request.args.get('difficulty')
    
    try:
        conn = get_db()
        cur = conn.cursor()
        
        # 建立查詢
        sql = '''
            SELECT id, subject, question, options, answer, explanation, context,
                   COALESCE(difficulty, 3) as difficulty
            FROM gsat_dedup_questions
            WHERE 1=1
        '''
        params = []
        
        if subject:
            sql += ' AND subject = ?'
            params.append(subject)
        
        if difficulty:
            sql += ' AND difficulty = ?'
            params.append(int(difficulty))
        
        sql += ' ORDER BY RANDOM() LIMIT ?'
        params.append(count)
        
        cur.execute(sql, params)
        rows = cur.fetchall()
        conn.close()
        
        questions = []
        for row in rows:
            # 解析 options (可能是 JSON 字串或已是 list)
            opts = row[3]
            if isinstance(opts, str):
                try:
                    opts = json.loads(opts)
                except:
                    opts = []
            
            questions.append({
                'id': row[0],
                'subject': row[1],
                'question': row[2],
                'options': opts,
                'answer': row[4],
                'explanation': row[5],
                'context': row[6],
                'difficulty': row[7]
            })
        
        return jsonify({
            'success': True,
            'data': questions,
            'count': len(questions)
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@gsat_questions_bp.route('/api/gsat/subjects', methods=['GET'])
def get_gsat_subjects():
    """列出所有科目及題數"""
    try:
        conn = get_db()
        cur = conn.cursor()
        
        cur.execute('''
            SELECT subject, COUNT(*) as count,
                   AVG(COALESCE(difficulty, 3)) as avg_difficulty
            FROM gsat_dedup_questions
            GROUP BY subject
            ORDER BY count DESC
        ''')
        rows = cur.fetchall()
        conn.close()
        
        subjects = []
        for row in rows:
            subjects.append({
                'subject': row[0],
                'count': row[1],
                'avg_difficulty': round(row[2], 1) if row[2] else 3.0
            })
        
        return jsonify({
            'success': True,
            'data': subjects,
            'total': sum(s['count'] for s in subjects)
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@gsat_questions_bp.route('/api/gsat/stats', methods=['GET'])
def get_gsat_stats():
    """取得題庫統計"""
    try:
        conn = get_db()
        cur = conn.cursor()
        
        # 總題數
        cur.execute('SELECT COUNT(*) FROM gsat_dedup_questions')
        total = cur.fetchone()[0]
        
        # 各科題數
        cur.execute('''
            SELECT subject, COUNT(*) FROM gsat_dedup_questions
            GROUP BY subject ORDER BY COUNT(*) DESC
        ''')
        by_subject = {row[0]: row[1] for row in cur.fetchall()}
        
        # 難度分布
        cur.execute('''
            SELECT COALESCE(difficulty, 3) as d, COUNT(*) 
            FROM gsat_dedup_questions
            GROUP BY d ORDER BY d
        ''')
        by_difficulty = {int(row[0]): row[1] for row in cur.fetchall()}
        
        conn.close()
        
        return jsonify({
            'success': True,
            'data': {
                'total_questions': total,
                'by_subject': by_subject,
                'by_difficulty': by_difficulty,
                'subjects_count': len(by_subject)
            }
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500
