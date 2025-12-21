/**
 * answers_routes.js - 答題記錄 API
 * 北斗教育 v2.0
 */

const express = require('express');
const router = express.Router();
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DB_PATH || './education.db';
function getDb() { return new Database(path.resolve(__dirname, dbPath)); }

// POST /answers/submit - 提交答案
router.post('/submit', (req, res) => {
  const db = getDb();
  try {
    const { userId, questionId, nodeId, subjectId, userAnswer, correctAnswer, timeSpent, sessionId } = req.body;
    
    if (!userId || !questionId) {
      return res.status(400).json({ success: false, error: 'userId and questionId required' });
    }
    
    const isCorrect = userAnswer === correctAnswer ? 1 : 0;
    
    // 記錄答題
    const result = db.prepare(`
      INSERT INTO user_answers (user_id, question_id, node_id, subject_id, user_answer, correct_answer, is_correct, time_spent, session_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, questionId, nodeId||'', subjectId||'', userAnswer, correctAnswer, isCorrect, timeSpent||0, sessionId||'');
    
    // 同步更新 user_progress
    if (nodeId) {
      const existing = db.prepare('SELECT * FROM user_progress WHERE user_id = ? AND node_id = ?').get(userId, nodeId);
      if (existing) {
        const ts = existing.total_questions + 1;
        const tc = existing.correct_count + isCorrect;
        const ml = Math.round((tc / ts) * 100);
        db.prepare(`UPDATE user_progress SET total_questions=?, correct_count=?, wrong_count=wrong_count+?, 
          mastery_level=?, last_studied_at=datetime('now') WHERE user_id=? AND node_id=?`)
          .run(ts, tc, isCorrect?0:1, ml, userId, nodeId);
      } else {
        db.prepare(`INSERT INTO user_progress (user_id, node_id, subject_id, total_questions, correct_count, wrong_count, mastery_level, last_studied_at)
          VALUES (?, ?, ?, 1, ?, ?, ?, datetime('now'))`)
          .run(userId, nodeId, subjectId||'', isCorrect, isCorrect?0:1, isCorrect?100:0);
      }
    }
    
    db.close();
    res.json({ success: true, data: { answerId: result.lastInsertRowid, isCorrect: !!isCorrect }});
  } catch (err) { db.close(); res.status(500).json({ success: false, error: err.message }); }
});

// GET /answers/history - 答題歷史
router.get('/history/:userId', (req, res) => {
  const db = getDb();
  try {
    const { userId } = req.params;
    const { limit = 50, offset = 0, subject, nodeId } = req.query;
    
    let sql = `SELECT a.*, n.node_name FROM user_answers a 
      LEFT JOIN xtf_nodes_v2 n ON a.node_id = n.node_id WHERE a.user_id = ?`;
    const params = [userId];
    
    if (subject) { sql += ' AND a.subject_id = ?'; params.push(subject); }
    if (nodeId) { sql += ' AND a.node_id = ?'; params.push(nodeId); }
    
    sql += ' ORDER BY a.answered_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));
    
    const history = db.prepare(sql).all(...params);
    const total = db.prepare(`SELECT COUNT(*) as c FROM user_answers WHERE user_id = ?`).get(userId).c;
    
    db.close();
    res.json({ success: true, data: { history, total, limit: parseInt(limit), offset: parseInt(offset) }});
  } catch (err) { db.close(); res.status(500).json({ success: false, error: err.message }); }
});

// GET /answers/stats - 答題統計
router.get('/stats/:userId', (req, res) => {
  const db = getDb();
  try {
    const { userId } = req.params;
    
    // 總體統計
    const overall = db.prepare(`
      SELECT COUNT(*) as total, SUM(is_correct) as correct, 
        ROUND(AVG(is_correct)*100, 1) as accuracy,
        ROUND(AVG(time_spent), 1) as avg_time
      FROM user_answers WHERE user_id = ?`).get(userId);
    
    // 按科目統計
    const bySubject = db.prepare(`
      SELECT subject_id, COUNT(*) as total, SUM(is_correct) as correct,
        ROUND(AVG(is_correct)*100, 1) as accuracy
      FROM user_answers WHERE user_id = ? AND subject_id != ''
      GROUP BY subject_id ORDER BY accuracy DESC`).all(userId);
    
    // 按日期統計 (最近7天)
    const byDate = db.prepare(`
      SELECT DATE(answered_at) as date, COUNT(*) as total, SUM(is_correct) as correct
      FROM user_answers WHERE user_id = ? AND answered_at >= date('now', '-7 days')
      GROUP BY DATE(answered_at) ORDER BY date DESC`).all(userId);
    
    // 今日統計
    const today = db.prepare(`
      SELECT COUNT(*) as total, SUM(is_correct) as correct
      FROM user_answers WHERE user_id = ? AND DATE(answered_at) = DATE('now')`).get(userId);
    
    db.close();
    res.json({ success: true, data: { userId, overall, bySubject, byDate, today }});
  } catch (err) { db.close(); res.status(500).json({ success: false, error: err.message }); }
});

// GET /answers/wrong - 錯題本
router.get('/wrong/:userId', (req, res) => {
  const db = getDb();
  try {
    const { userId } = req.params;
    const { subject, limit = 50 } = req.query;
    
    let sql = `SELECT a.*, n.node_name, n.chapter_id
      FROM user_answers a
      LEFT JOIN xtf_nodes_v2 n ON a.node_id = n.node_id
      WHERE a.user_id = ? AND a.is_correct = 0`;
    const params = [userId];
    
    if (subject) { sql += ' AND a.subject_id = ?'; params.push(subject); }
    sql += ' ORDER BY a.answered_at DESC LIMIT ?';
    params.push(parseInt(limit));
    
    const wrongAnswers = db.prepare(sql).all(...params);
    
    // 按節點分組統計錯題數
    const byNode = db.prepare(`
      SELECT node_id, COUNT(*) as wrong_count
      FROM user_answers WHERE user_id = ? AND is_correct = 0 AND node_id != ''
      GROUP BY node_id ORDER BY wrong_count DESC LIMIT 10`).all(userId);
    
    db.close();
    res.json({ success: true, data: { userId, wrongAnswers, byNode, total: wrongAnswers.length }});
  } catch (err) { db.close(); res.status(500).json({ success: false, error: err.message }); }
});

module.exports = router;
