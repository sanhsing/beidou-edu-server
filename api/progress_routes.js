/**
 * progress_routes.js - 學習進度 API
 * 北斗教育 v2.0
 */

const express = require('express');
const router = express.Router();
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DB_PATH || './education.db';
function getDb() { return new Database(path.resolve(__dirname, dbPath)); }

// GET /progress/:userId - 取得用戶所有進度
router.get('/:userId', (req, res) => {
  const db = getDb();
  try {
    const { userId } = req.params;
    const { subject } = req.query;
    
    let sql = `SELECT p.*, n.node_name, n.chapter_id
      FROM user_progress p
      LEFT JOIN xtf_nodes_v2 n ON p.node_id = n.node_id
      WHERE p.user_id = ?`;
    const params = [userId];
    
    if (subject) { sql += ' AND p.subject_id = ?'; params.push(subject); }
    sql += ' ORDER BY p.subject_id, p.node_id';
    
    const progress = db.prepare(sql).all(...params);
    const summary = db.prepare(`
      SELECT COUNT(DISTINCT node_id) as nodes_studied,
        COUNT(DISTINCT subject_id) as subjects_studied,
        ROUND(AVG(mastery_level), 1) as avg_mastery,
        SUM(total_questions) as total_questions,
        SUM(correct_count) as total_correct
      FROM user_progress WHERE user_id = ?`).get(userId);
    
    db.close();
    res.json({ success: true, data: { userId, summary, progress }});
  } catch (err) { db.close(); res.status(500).json({ success: false, error: err.message }); }
});

// POST /progress/update - 更新進度
router.post('/update', (req, res) => {
  const db = getDb();
  try {
    const { userId, nodeId, subjectId, isCorrect } = req.body;
    if (!userId || !nodeId) return res.status(400).json({ success: false, error: 'userId and nodeId required' });
    
    const existing = db.prepare('SELECT * FROM user_progress WHERE user_id = ? AND node_id = ?').get(userId, nodeId);
    
    if (existing) {
      const ts = existing.total_questions + 1;
      const tc = existing.correct_count + (isCorrect ? 1 : 0);
      const tw = existing.wrong_count + (isCorrect ? 0 : 1);
      const ml = Math.round((tc / ts) * 100);
      db.prepare(`UPDATE user_progress SET total_questions=?, correct_count=?, wrong_count=?, mastery_level=?, 
        last_studied_at=datetime('now'), updated_at=datetime('now') WHERE user_id=? AND node_id=?`).run(ts, tc, tw, ml, userId, nodeId);
    } else {
      db.prepare(`INSERT INTO user_progress (user_id, node_id, subject_id, total_questions, correct_count, wrong_count, mastery_level, last_studied_at)
        VALUES (?, ?, ?, 1, ?, ?, ?, datetime('now'))`).run(userId, nodeId, subjectId||'', isCorrect?1:0, isCorrect?0:1, isCorrect?100:0);
    }
    
    const updated = db.prepare('SELECT * FROM user_progress WHERE user_id = ? AND node_id = ?').get(userId, nodeId);
    db.close();
    res.json({ success: true, data: updated });
  } catch (err) { db.close(); res.status(500).json({ success: false, error: err.message }); }
});

// GET /progress/summary/:userId - 進度摘要
router.get('/summary/:userId', (req, res) => {
  const db = getDb();
  try {
    const { userId } = req.params;
    const bySubject = db.prepare(`SELECT subject_id, COUNT(*) as nodes_count, ROUND(AVG(mastery_level),1) as avg_mastery,
      SUM(total_questions) as total_studied, SUM(correct_count) as total_correct
      FROM user_progress WHERE user_id = ? GROUP BY subject_id ORDER BY avg_mastery DESC`).all(userId);
    
    const overall = db.prepare(`SELECT COUNT(DISTINCT node_id) as total_nodes, ROUND(AVG(mastery_level),1) as overall_mastery,
      SUM(total_questions) as total_questions, SUM(correct_count) as total_correct, MAX(last_studied_at) as last_active
      FROM user_progress WHERE user_id = ?`).get(userId);
    
    db.close();
    res.json({ success: true, data: { userId, overall, bySubject }});
  } catch (err) { db.close(); res.status(500).json({ success: false, error: err.message }); }
});

// GET /progress/subject/:userId/:subjectId - 科目詳細進度
router.get('/subject/:userId/:subjectId', (req, res) => {
  const db = getDb();
  try {
    const { userId, subjectId } = req.params;
    const nodes = db.prepare(`SELECT p.*, n.node_name, n.chapter_id, n.node_type
      FROM user_progress p JOIN xtf_nodes_v2 n ON p.node_id = n.node_id
      WHERE p.user_id = ? AND p.subject_id = ? ORDER BY p.mastery_level ASC`).all(userId, subjectId);
    
    const weakNodes = nodes.filter(n => n.mastery_level < 70);
    db.close();
    res.json({ success: true, data: { userId, subjectId, nodes, weakNodes, stats: { total: nodes.length, weak: weakNodes.length }}});
  } catch (err) { db.close(); res.status(500).json({ success: false, error: err.message }); }
});

module.exports = router;
