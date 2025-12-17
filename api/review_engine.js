/**
 * 北斗教育 - 複習排程引擎
 * 艾賓浩斯遺忘曲線 + SM-2 演算法
 * 2025-12-16
 */

// ============================================================
// 艾賓浩斯間隔 (天)
// ============================================================
const EBBINGHAUS_INTERVALS = [1, 2, 4, 7, 15, 30, 60, 120];

// ============================================================
// SM-2 演算法核心
// ============================================================

/**
 * SM-2 演算法 - 計算下次複習時間
 * @param {number} quality - 回答品質 (0-5)
 *   0 = 完全忘記
 *   1 = 錯誤但記得一點
 *   2 = 錯誤但感覺熟悉
 *   3 = 正確但很費力
 *   4 = 正確且順利
 *   5 = 完美記得
 * @param {number} repetition - 當前複習次數
 * @param {number} easiness - 難易度因子 (1.3-2.5)
 * @param {number} interval - 當前間隔天數
 * @returns {Object} 更新後的參數
 */
function sm2Algorithm(quality, repetition, easiness, interval) {
  // 更新難易度因子
  let newEasiness = easiness + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  newEasiness = Math.max(1.3, newEasiness); // 最小 1.3
  
  let newRepetition, newInterval;
  
  if (quality < 3) {
    // 回答錯誤，重新開始
    newRepetition = 0;
    newInterval = 1;
  } else {
    // 回答正確
    newRepetition = repetition + 1;
    
    if (newRepetition === 1) {
      newInterval = 1;
    } else if (newRepetition === 2) {
      newInterval = 6;
    } else {
      newInterval = Math.round(interval * newEasiness);
    }
  }
  
  return {
    repetition: newRepetition,
    easiness: newEasiness,
    interval: newInterval
  };
}

/**
 * 簡化版：根據答題結果計算下次複習
 * @param {boolean} isCorrect - 是否答對
 * @param {number} currentStreak - 當前連續正確次數
 * @returns {Object} 排程資訊
 */
function calculateNextReview(isCorrect, currentStreak) {
  if (!isCorrect) {
    // 答錯：重置到第一個間隔
    return {
      interval: 1,
      streak: 0,
      status: 'learning'
    };
  }
  
  // 答對：根據連續正確次數選擇間隔
  const newStreak = currentStreak + 1;
  const intervalIndex = Math.min(newStreak - 1, EBBINGHAUS_INTERVALS.length - 1);
  const interval = EBBINGHAUS_INTERVALS[intervalIndex];
  
  // 超過 60 天視為已掌握
  const status = interval >= 60 ? 'mastered' : 'review';
  
  return {
    interval,
    streak: newStreak,
    status
  };
}

// ============================================================
// API 處理函數
// ============================================================

/**
 * POST /api/cert/review/record
 * 記錄複習結果
 */
async function recordReviewHandler(req, res, db) {
  try {
    const { user_id, cert_id, node_id, is_correct, quality } = req.body;
    
    if (!user_id || !cert_id || !node_id) {
      return res.status(400).json({ success: false, error: 'Missing parameters' });
    }
    
    const now = new Date().toISOString();
    
    // 查詢現有記錄
    const existing = await dbGet(db, `
      SELECT * FROM cert_review_schedule 
      WHERE user_id = ? AND cert_id = ? AND node_id = ?
    `, [user_id, cert_id, node_id]);
    
    if (!existing) {
      // 新記錄
      const { interval, streak, status } = calculateNextReview(is_correct, 0);
      const nextReview = addDays(new Date(), interval).toISOString();
      
      await dbRun(db, `
        INSERT INTO cert_review_schedule 
        (user_id, cert_id, node_id, first_learned_at, last_reviewed_at, next_review_at,
         repetition, interval, correct_streak, total_reviews, total_correct, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        user_id, cert_id, node_id, now, now, nextReview,
        is_correct ? 1 : 0, interval, streak, 1, is_correct ? 1 : 0, status, now, now
      ]);
      
      res.json({
        success: true,
        data: {
          is_new: true,
          next_review: nextReview,
          interval_days: interval,
          status
        }
      });
    } else {
      // 更新現有記錄
      const { interval, streak, status } = calculateNextReview(is_correct, existing.correct_streak);
      const nextReview = addDays(new Date(), interval).toISOString();
      
      await dbRun(db, `
        UPDATE cert_review_schedule SET
          last_reviewed_at = ?,
          next_review_at = ?,
          repetition = repetition + 1,
          interval = ?,
          correct_streak = ?,
          total_reviews = total_reviews + 1,
          total_correct = total_correct + ?,
          status = ?,
          updated_at = ?
        WHERE user_id = ? AND cert_id = ? AND node_id = ?
      `, [
        now, nextReview, interval, streak, is_correct ? 1 : 0, status, now,
        user_id, cert_id, node_id
      ]);
      
      res.json({
        success: true,
        data: {
          is_new: false,
          next_review: nextReview,
          interval_days: interval,
          streak,
          status,
          total_reviews: existing.total_reviews + 1
        }
      });
    }
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * GET /api/cert/review/due/:userId
 * 獲取待複習項目
 */
async function getDueReviewsHandler(req, res, db) {
  try {
    const { userId } = req.params;
    const { cert_id, limit = 20 } = req.query;
    
    const now = new Date().toISOString();
    
    let sql = `
      SELECT r.*, x.x_plain, x.f_mnemonics
      FROM cert_review_schedule r
      LEFT JOIN ai_cert_xtf_knowledge x ON r.node_id = x.node_id
      WHERE r.user_id = ? AND r.next_review_at <= ?
    `;
    const params = [userId, now];
    
    if (cert_id) {
      sql += ' AND r.cert_id = ?';
      params.push(cert_id);
    }
    
    sql += ' ORDER BY r.next_review_at ASC LIMIT ?';
    params.push(parseInt(limit));
    
    const rows = await dbAll(db, sql, params);
    
    res.json({
      success: true,
      data: {
        due_count: rows.length,
        items: rows.map(r => ({
          node_id: r.node_id,
          cert_id: r.cert_id,
          plain: r.x_plain,
          mnemonics: r.f_mnemonics,
          last_reviewed: r.last_reviewed_at,
          streak: r.correct_streak,
          status: r.status
        }))
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * GET /api/cert/review/stats/:userId
 * 獲取複習統計
 */
async function getReviewStatsHandler(req, res, db) {
  try {
    const { userId } = req.params;
    const { cert_id } = req.query;
    
    let whereClause = 'WHERE user_id = ?';
    const params = [userId];
    
    if (cert_id) {
      whereClause += ' AND cert_id = ?';
      params.push(cert_id);
    }
    
    // 總體統計
    const total = await dbGet(db, `
      SELECT 
        COUNT(*) as total_nodes,
        SUM(CASE WHEN status = 'mastered' THEN 1 ELSE 0 END) as mastered,
        SUM(CASE WHEN status = 'review' THEN 1 ELSE 0 END) as reviewing,
        SUM(CASE WHEN status = 'learning' THEN 1 ELSE 0 END) as learning,
        SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) as new_nodes,
        SUM(total_reviews) as total_reviews,
        SUM(total_correct) as total_correct
      FROM cert_review_schedule ${whereClause}
    `, params);
    
    // 待複習數量
    const now = new Date().toISOString();
    const due = await dbGet(db, `
      SELECT COUNT(*) as due_count
      FROM cert_review_schedule ${whereClause} AND next_review_at <= ?
    `, [...params, now]);
    
    const accuracy = total.total_reviews > 0 
      ? (total.total_correct / total.total_reviews * 100).toFixed(1)
      : 0;
    
    res.json({
      success: true,
      data: {
        total_nodes: total.total_nodes || 0,
        mastered: total.mastered || 0,
        reviewing: total.reviewing || 0,
        learning: total.learning || 0,
        new_nodes: total.new_nodes || 0,
        due_today: due.due_count || 0,
        total_reviews: total.total_reviews || 0,
        accuracy: parseFloat(accuracy),
        mastery_rate: total.total_nodes > 0 
          ? ((total.mastered || 0) / total.total_nodes * 100).toFixed(1)
          : 0
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * GET /api/cert/review/calendar/:userId
 * 獲取複習日曆
 */
async function getReviewCalendarHandler(req, res, db) {
  try {
    const { userId } = req.params;
    const { days = 30 } = req.query;
    
    const endDate = addDays(new Date(), parseInt(days)).toISOString();
    
    const rows = await dbAll(db, `
      SELECT DATE(next_review_at) as date, COUNT(*) as count
      FROM cert_review_schedule
      WHERE user_id = ? AND next_review_at <= ?
      GROUP BY DATE(next_review_at)
      ORDER BY date
    `, [userId, endDate]);
    
    res.json({
      success: true,
      data: {
        calendar: rows
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// ============================================================
// 輔助函數
// ============================================================

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function dbGet(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function dbAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

function dbRun(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

// ============================================================
// 導出
// ============================================================

module.exports = {
  sm2Algorithm,
  calculateNextReview,
  recordReviewHandler,
  getDueReviewsHandler,
  getReviewStatsHandler,
  getReviewCalendarHandler,
  EBBINGHAUS_INTERVALS
};
