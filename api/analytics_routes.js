/**
 * analytics_routes.js - 統計分析 API (P1)
 */

const express = require('express');
const router = express.Router();
const sqlite3 = require('sqlite3').verbose();

const DB_PATH = process.env.EDU_DB_PATH || './education.db';
let db = null;

function getDb() {
  if (!db) {
    db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) console.error('Analytics DB error:', err);
      else console.log('✅ analytics_routes: education.db 連線成功');
    });
  }
  return db;
}

getDb();

const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
  getDb().all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
});

const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
  getDb().get(sql, params, (err, row) => err ? reject(err) : resolve(row));
});

// GET /api/analytics/dashboard/:userId
router.get('/dashboard/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    // 總覽
    const overview = await dbGet(`
      SELECT 
        COUNT(DISTINCT node_id) as nodes_studied,
        ROUND(AVG(mastery_level), 1) as avg_mastery,
        SUM(total_questions) as total_questions,
        SUM(correct_count) as total_correct,
        MAX(streak_days) as streak_days
      FROM user_progress WHERE user_id = ?
    `, [userId]) || {};

    // 今日
    const today = await dbGet(`
      SELECT 
        COUNT(*) as questions,
        SUM(is_correct) as correct
      FROM user_answers 
      WHERE user_id = ? AND DATE(answered_at) = DATE('now')
    `, [userId]) || { questions: 0, correct: 0 };

    // 錯題數
    const wrongCount = await dbGet(`
      SELECT COUNT(*) as cnt FROM user_answers 
      WHERE user_id = ? AND is_correct = 0
    `, [userId]);
    overview.wrong_count = wrongCount?.cnt || 0;

    // 最近7天活動
    const recentActivity = await dbAll(`
      SELECT DATE(answered_at) as date, COUNT(*) as count
      FROM user_answers 
      WHERE user_id = ? AND answered_at >= DATE('now', '-7 days')
      GROUP BY DATE(answered_at)
      ORDER BY date
    `, [userId]);

    res.json({ 
      success: true, 
      data: { overview, today, recentActivity, rank: { current: null } } 
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/analytics/trends/:userId
router.get('/trends/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { days = 30 } = req.query;

    const dailyTrend = await dbAll(`
      SELECT 
        DATE(answered_at) as date,
        COUNT(*) as total,
        SUM(is_correct) as correct,
        ROUND(AVG(is_correct) * 100, 1) as accuracy
      FROM user_answers 
      WHERE user_id = ? AND answered_at >= DATE('now', '-' || ? || ' days')
      GROUP BY DATE(answered_at)
      ORDER BY date
    `, [userId, days]);

    const subjectTrend = await dbAll(`
      SELECT 
        subject_id,
        COUNT(*) as total,
        SUM(is_correct) as correct,
        ROUND(AVG(is_correct) * 100, 1) as accuracy
      FROM user_answers 
      WHERE user_id = ? AND subject_id != ''
      GROUP BY subject_id
      ORDER BY total DESC
    `, [userId]);

    res.json({ success: true, data: { dailyTrend, subjectTrend } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/analytics/weakness/:userId
router.get('/weakness/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const weakSubjects = await dbAll(`
      SELECT 
        subject_id,
        COUNT(*) as total,
        SUM(is_correct) as correct,
        ROUND(AVG(is_correct) * 100, 1) as accuracy
      FROM user_answers 
      WHERE user_id = ? AND subject_id != ''
      GROUP BY subject_id
      HAVING accuracy < 70
      ORDER BY accuracy ASC
      LIMIT 5
    `, [userId]);

    const weakNodes = await dbAll(`
      SELECT node_id, subject_id, mastery_level, total_questions
      FROM user_progress 
      WHERE user_id = ? AND mastery_level < 60
      ORDER BY mastery_level ASC
      LIMIT 10
    `, [userId]);

    // 學習建議
    const recommendations = weakNodes.slice(0, 3).map(n => ({
      nodeId: n.node_id,
      nodeName: n.node_id,
      reason: `掌握度 ${n.mastery_level}%，建議加強練習`
    }));

    res.json({ success: true, data: { weakSubjects, weakNodes, recommendations } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/analytics/leaderboard
router.get('/leaderboard', async (req, res) => {
  try {
    const { type = 'mastery', limit = 20 } = req.query;

    let orderBy = 'avg_mastery DESC';
    if (type === 'questions') orderBy = 'total_questions DESC';
    if (type === 'accuracy') orderBy = 'accuracy DESC';

    const leaderboard = await dbAll(`
      SELECT 
        user_id,
        ROUND(AVG(mastery_level), 1) as avg_mastery,
        SUM(total_questions) as total_questions,
        SUM(correct_count) as total_correct,
        ROUND(SUM(correct_count) * 100.0 / NULLIF(SUM(total_questions), 0), 1) as accuracy,
        COUNT(DISTINCT node_id) as nodes_count
      FROM user_progress
      GROUP BY user_id
      ORDER BY ${orderBy}
      LIMIT ?
    `, [parseInt(limit)]);

    // 加排名
    const ranked = leaderboard.map((u, i) => ({ ...u, rank: i + 1 }));

    res.json({ success: true, data: { leaderboard: ranked, type } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
