/**
 * analytics_routes.js - 統計分析 API
 * 北斗教育 v2.0
 */

const express = require('express');
const router = express.Router();
const Database = require('better-sqlite3');
const path = require('path');

const dbPath = process.env.DB_PATH || './education.db';
function getDb() { return new Database(path.resolve(__dirname, dbPath), { readonly: true }); }

// GET /analytics/dashboard/:userId - 儀表板數據
router.get('/dashboard/:userId', (req, res) => {
  const db = getDb();
  try {
    const { userId } = req.params;
    
    // 用戶總覽
    const overview = db.prepare(`
      SELECT * FROM v_user_stats WHERE user_id = ?`).get(userId) || {
        nodes_studied: 0, subjects_studied: 0, avg_mastery: 0, 
        total_questions: 0, total_correct: 0, wrong_count: 0
      };
    
    // 今日數據
    const today = db.prepare(`
      SELECT COUNT(*) as questions, SUM(is_correct) as correct
      FROM user_answers WHERE user_id = ? AND DATE(answered_at) = DATE('now')`).get(userId);
    
    // 本週數據
    const week = db.prepare(`
      SELECT COUNT(*) as questions, SUM(is_correct) as correct
      FROM user_answers WHERE user_id = ? AND answered_at >= date('now', '-7 days')`).get(userId);
    
    // 排名
    const allUsers = db.prepare(`SELECT user_id, avg_mastery FROM v_leaderboard ORDER BY avg_mastery DESC`).all();
    const rank = allUsers.findIndex(u => u.user_id === userId) + 1;
    
    // 最近活動
    const recentActivity = db.prepare(`
      SELECT DATE(answered_at) as date, COUNT(*) as count
      FROM user_answers WHERE user_id = ? 
      GROUP BY DATE(answered_at) ORDER BY date DESC LIMIT 7`).all(userId);
    
    db.close();
    res.json({ success: true, data: { userId, overview, today, week, rank: { current: rank, total: allUsers.length }, recentActivity }});
  } catch (err) { db.close(); res.status(500).json({ success: false, error: err.message }); }
});

// GET /analytics/trends/:userId - 學習趨勢
router.get('/trends/:userId', (req, res) => {
  const db = getDb();
  try {
    const { userId } = req.params;
    const { days = 30 } = req.query;
    
    // 每日答題趨勢
    const dailyTrend = db.prepare(`
      SELECT DATE(answered_at) as date, 
        COUNT(*) as questions, 
        SUM(is_correct) as correct,
        ROUND(AVG(is_correct)*100, 1) as accuracy
      FROM user_answers WHERE user_id = ? AND answered_at >= date('now', '-' || ? || ' days')
      GROUP BY DATE(answered_at) ORDER BY date`).all(userId, days);
    
    // 按科目趨勢
    const subjectTrend = db.prepare(`
      SELECT subject_id, 
        COUNT(*) as total,
        SUM(is_correct) as correct,
        ROUND(AVG(is_correct)*100, 1) as accuracy
      FROM user_answers WHERE user_id = ? AND subject_id != ''
      GROUP BY subject_id ORDER BY total DESC`).all(userId);
    
    // 掌握度變化 (按週)
    const masteryTrend = db.prepare(`
      SELECT strftime('%Y-W%W', last_studied_at) as week,
        ROUND(AVG(mastery_level), 1) as avg_mastery,
        COUNT(*) as nodes
      FROM user_progress WHERE user_id = ?
      GROUP BY week ORDER BY week DESC LIMIT 8`).all(userId);
    
    db.close();
    res.json({ success: true, data: { userId, dailyTrend, subjectTrend, masteryTrend }});
  } catch (err) { db.close(); res.status(500).json({ success: false, error: err.message }); }
});

// GET /analytics/weakness/:userId - 弱點分析
router.get('/weakness/:userId', (req, res) => {
  const db = getDb();
  try {
    const { userId } = req.params;
    
    // 弱點科目 (正確率最低)
    const weakSubjects = db.prepare(`
      SELECT subject_id, 
        COUNT(*) as total,
        SUM(is_correct) as correct,
        ROUND(AVG(is_correct)*100, 1) as accuracy
      FROM user_answers WHERE user_id = ? AND subject_id != ''
      GROUP BY subject_id
      HAVING accuracy < 70
      ORDER BY accuracy ASC LIMIT 5`).all(userId);
    
    // 弱點節點 (mastery < 70)
    const weakNodes = db.prepare(`
      SELECT p.node_id, p.subject_id, p.mastery_level, p.total_questions, p.correct_count,
        n.node_name, n.chapter_id
      FROM user_progress p
      LEFT JOIN xtf_nodes_v2 n ON p.node_id = n.node_id
      WHERE p.user_id = ? AND p.mastery_level < 70
      ORDER BY p.mastery_level ASC LIMIT 10`).all(userId);
    
    // 高錯誤率題目
    const highErrorQuestions = db.prepare(`
      SELECT question_id, node_id, COUNT(*) as attempts, 
        SUM(is_correct) as correct,
        ROUND(AVG(is_correct)*100, 1) as accuracy
      FROM user_answers WHERE user_id = ?
      GROUP BY question_id
      HAVING attempts >= 2 AND accuracy < 50
      ORDER BY accuracy ASC LIMIT 10`).all(userId);
    
    // 推薦複習
    const recommendations = weakNodes.slice(0, 5).map(n => ({
      nodeId: n.node_id,
      nodeName: n.node_name,
      currentMastery: n.mastery_level,
      reason: n.mastery_level < 50 ? '急需加強' : '建議複習'
    }));
    
    db.close();
    res.json({ success: true, data: { userId, weakSubjects, weakNodes, highErrorQuestions, recommendations }});
  } catch (err) { db.close(); res.status(500).json({ success: false, error: err.message }); }
});

// GET /leaderboard - 排行榜
router.get('/leaderboard', (req, res) => {
  const db = getDb();
  try {
    const { limit = 20, type = 'mastery' } = req.query;
    
    let orderBy = 'avg_mastery DESC';
    if (type === 'questions') orderBy = 'total_questions DESC';
    if (type === 'accuracy') orderBy = 'accuracy DESC';
    if (type === 'nodes') orderBy = 'nodes_count DESC';
    
    const leaderboard = db.prepare(`
      SELECT user_id, avg_mastery, total_questions, total_correct, accuracy, nodes_count, last_active
      FROM v_leaderboard
      ORDER BY ${orderBy}
      LIMIT ?`).all(parseInt(limit));
    
    // 加入排名
    const ranked = leaderboard.map((user, idx) => ({ rank: idx + 1, ...user }));
    
    db.close();
    res.json({ success: true, data: { type, leaderboard: ranked }});
  } catch (err) { db.close(); res.status(500).json({ success: false, error: err.message }); }
});

module.exports = router;
