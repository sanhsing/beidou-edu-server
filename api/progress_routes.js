/**
 * progress_routes.js - 學習進度 API (P1)
 * 使用 sqlite3 (async callback style)
 */

const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// DB 連線
const DB_PATH = process.env.DB_PATH || './education.db';
let db = null;

function getDb() {
  if (!db) {
    db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) console.error('Progress DB error:', err);
      else console.log('✅ progress_routes: education.db 連線成功');
    });
  }
  return db;
}

// 初始化連線
getDb();

// 輔助函數: Promise 包裝
const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
  getDb().all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
});

const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
  getDb().get(sql, params, (err, row) => err ? reject(err) : resolve(row));
});

const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
  getDb().run(sql, params, function(err) {
    err ? reject(err) : resolve({ lastID: this.lastID, changes: this.changes });
  });
});

// GET /api/progress/:userId - 取得用戶進度
router.get('/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const progress = await dbAll(
      'SELECT * FROM user_progress WHERE user_id = ? ORDER BY last_studied_at DESC',
      [userId]
    );
    res.json({ success: true, data: { userId, progress } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/progress/summary/:userId - 進度摘要
router.get('/summary/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const summary = await dbGet(`
      SELECT 
        COUNT(DISTINCT node_id) as nodes_studied,
        COUNT(DISTINCT subject_id) as subjects_studied,
        ROUND(AVG(mastery_level), 1) as avg_mastery,
        SUM(total_questions) as total_questions,
        SUM(correct_count) as total_correct,
        MAX(streak_days) as max_streak
      FROM user_progress WHERE user_id = ?
    `, [userId]);
    res.json({ success: true, data: summary || {} });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/progress/update - 更新進度
router.post('/update', async (req, res) => {
  try {
    const { userId, nodeId, subjectId, correct, total } = req.body;
    
    if (!userId || !nodeId) {
      return res.status(400).json({ success: false, error: '缺少必要參數' });
    }

    // Upsert
    const existing = await dbGet(
      'SELECT * FROM user_progress WHERE user_id = ? AND node_id = ?',
      [userId, nodeId]
    );

    if (existing) {
      const newTotal = (existing.total_questions || 0) + (total || 1);
      const newCorrect = (existing.correct_count || 0) + (correct || 0);
      const mastery = Math.round(newCorrect / newTotal * 100);
      
      await dbRun(`
        UPDATE user_progress SET 
          total_questions = ?, correct_count = ?, mastery_level = ?,
          last_studied_at = datetime('now'), updated_at = datetime('now')
        WHERE user_id = ? AND node_id = ?
      `, [newTotal, newCorrect, mastery, userId, nodeId]);
    } else {
      const mastery = total > 0 ? Math.round((correct || 0) / total * 100) : 0;
      await dbRun(`
        INSERT INTO user_progress (user_id, node_id, subject_id, total_questions, correct_count, mastery_level, last_studied_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      `, [userId, nodeId, subjectId || '', total || 1, correct || 0, mastery]);
    }

    res.json({ success: true, message: '進度已更新' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
