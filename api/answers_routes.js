/**
 * answers_routes.js - 答題記錄 API (P1)
 */

const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = process.env.DB_PATH || './education.db';
let db = null;

function getDb() {
  if (!db) {
    db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) console.error('Answers DB error:', err);
      else console.log('✅ answers_routes: education.db 連線成功');
    });
  }
  return db;
}

getDb();

const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
  getDb().all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
});

const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
  getDb().run(sql, params, function(err) {
    err ? reject(err) : resolve({ lastID: this.lastID, changes: this.changes });
  });
});

// POST /api/answers/submit - 提交答案
router.post('/submit', async (req, res) => {
  try {
    const { userId, questionId, nodeId, subjectId, userAnswer, correctAnswer, timeSpent } = req.body;
    
    if (!userId || !questionId) {
      return res.status(400).json({ success: false, error: '缺少必要參數' });
    }

    const isCorrect = userAnswer === correctAnswer ? 1 : 0;

    await dbRun(`
      INSERT INTO user_answers (user_id, question_id, node_id, subject_id, user_answer, correct_answer, is_correct, time_spent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [userId, questionId, nodeId || '', subjectId || '', userAnswer, correctAnswer, isCorrect, timeSpent || 0]);

    res.json({ success: true, isCorrect: !!isCorrect });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/answers/history/:userId - 答題歷史
router.get('/history/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 50, offset = 0 } = req.query;
    
    const history = await dbAll(`
      SELECT * FROM user_answers 
      WHERE user_id = ? 
      ORDER BY answered_at DESC 
      LIMIT ? OFFSET ?
    `, [userId, parseInt(limit), parseInt(offset)]);

    res.json({ success: true, data: history });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/answers/stats/:userId - 答題統計
router.get('/stats/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const stats = await dbAll(`
      SELECT 
        subject_id,
        COUNT(*) as total,
        SUM(is_correct) as correct,
        ROUND(AVG(is_correct) * 100, 1) as accuracy,
        ROUND(AVG(time_spent), 1) as avg_time
      FROM user_answers 
      WHERE user_id = ? 
      GROUP BY subject_id
    `, [userId]);

    res.json({ success: true, data: stats });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/answers/wrong/:userId - 錯題
router.get('/wrong/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 50 } = req.query;
    
    const wrong = await dbAll(`
      SELECT * FROM user_answers 
      WHERE user_id = ? AND is_correct = 0 
      ORDER BY answered_at DESC 
      LIMIT ?
    `, [userId, parseInt(limit)]);

    res.json({ success: true, data: wrong, count: wrong.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
