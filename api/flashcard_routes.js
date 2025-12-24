/**
 * flashcard_routes.js - 閃卡 API
 * 北斗教育 v46
 * 
 * 基於 knowledge_xtf 表的 XTF 閃卡功能
 */

const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// 資料庫連線
const dbPath = process.env.DB_PATH || './education.db';
let db = null;

function getDb() {
    if (!db) {
        db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                console.error('❌ flashcard_routes: 資料庫連線失敗', err);
            } else {
                console.log('✅ flashcard_routes: education.db 連線成功');
            }
        });
    }
    return db;
}

// 初始化連線
getDb();

/**
 * GET /api/flashcards
 * 取得閃卡列表
 * Query: subject, limit, offset, difficulty
 */
router.get('/', (req, res) => {
    const { subject, limit = 20, offset = 0, difficulty } = req.query;
    
    let sql = `SELECT id, node_id, subject_id, node_name, understand, memorize, apply, 
               difficulty, importance FROM knowledge_xtf WHERE 1=1`;
    const params = [];
    
    if (subject) {
        sql += ` AND subject_id = ?`;
        params.push(subject);
    }
    
    if (difficulty) {
        sql += ` AND difficulty = ?`;
        params.push(parseInt(difficulty));
    }
    
    sql += ` ORDER BY importance DESC, id LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));
    
    getDb().all(sql, params, (err, rows) => {
        if (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
        
        // 轉換為閃卡格式
        const flashcards = rows.map(row => ({
            id: row.id,
            nodeId: row.node_id,
            subject: row.subject_id,
            title: row.node_name,
            front: row.node_name,
            back: {
                understand: row.understand,
                memorize: row.memorize,
                apply: row.apply
            },
            difficulty: row.difficulty,
            importance: row.importance
        }));
        
        res.json({ success: true, data: flashcards, count: flashcards.length });
    });
});

/**
 * GET /api/flashcards/:id
 * 取得單張閃卡
 */
router.get('/:id', (req, res) => {
    const { id } = req.params;
    
    const sql = `SELECT * FROM knowledge_xtf WHERE id = ? OR node_id = ?`;
    
    getDb().get(sql, [id, id], (err, row) => {
        if (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
        
        if (!row) {
            return res.status(404).json({ success: false, error: '閃卡不存在' });
        }
        
        res.json({
            success: true,
            data: {
                id: row.id,
                nodeId: row.node_id,
                subject: row.subject_id,
                title: row.node_name,
                xtf: {
                    understand: row.understand,
                    memorize: row.memorize,
                    apply: row.apply
                },
                link: row.link,
                difficulty: row.difficulty,
                importance: row.importance
            }
        });
    });
});

/**
 * GET /api/flashcards/subjects
 * 取得科目列表及統計
 */
router.get('/stats/subjects', (req, res) => {
    const sql = `SELECT subject_id, COUNT(*) as count, 
                 AVG(difficulty) as avg_difficulty
                 FROM knowledge_xtf 
                 GROUP BY subject_id 
                 ORDER BY count DESC`;
    
    getDb().all(sql, [], (err, rows) => {
        if (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
        
        res.json({ success: true, data: rows });
    });
});

/**
 * GET /api/flashcards/random
 * 隨機取得閃卡
 */
router.get('/mode/random', (req, res) => {
    const { subject, count = 10 } = req.query;
    
    let sql = `SELECT id, node_id, subject_id, node_name, understand, memorize, apply,
               difficulty, importance FROM knowledge_xtf`;
    const params = [];
    
    if (subject) {
        sql += ` WHERE subject_id = ?`;
        params.push(subject);
    }
    
    sql += ` ORDER BY RANDOM() LIMIT ?`;
    params.push(parseInt(count));
    
    getDb().all(sql, params, (err, rows) => {
        if (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
        
        const flashcards = rows.map(row => ({
            id: row.id,
            nodeId: row.node_id,
            subject: row.subject_id,
            title: row.node_name,
            front: row.node_name,
            back: {
                understand: row.understand,
                memorize: row.memorize,
                apply: row.apply
            },
            difficulty: row.difficulty,
            importance: row.importance
        }));
        
        res.json({ success: true, data: flashcards });
    });
});

/**
 * GET /api/flashcards/search
 * 搜尋閃卡
 */
router.get('/mode/search', (req, res) => {
    const { q, limit = 20 } = req.query;
    
    if (!q) {
        return res.status(400).json({ success: false, error: '請提供搜尋關鍵字' });
    }
    
    const sql = `SELECT id, node_id, subject_id, node_name, understand, memorize, apply,
                 difficulty, importance FROM knowledge_xtf 
                 WHERE node_name LIKE ? OR understand LIKE ? OR memorize LIKE ? OR apply LIKE ?
                 LIMIT ?`;
    
    const keyword = `%${q}%`;
    
    getDb().all(sql, [keyword, keyword, keyword, keyword, parseInt(limit)], (err, rows) => {
        if (err) {
            return res.status(500).json({ success: false, error: err.message });
        }
        
        const flashcards = rows.map(row => ({
            id: row.id,
            nodeId: row.node_id,
            subject: row.subject_id,
            title: row.node_name,
            front: row.node_name,
            back: {
                understand: row.understand,
                memorize: row.memorize,
                apply: row.apply
            },
            difficulty: row.difficulty,
            importance: row.importance
        }));
        
        res.json({ success: true, data: flashcards, query: q });
    });
});

module.exports = router;
