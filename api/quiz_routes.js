/**
 * 北斗教育題庫 API 路由
 * 三層聯動查詢接口
 * 2025-12-15
 */

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const router = express.Router();

// ============================================================
// 資料庫連接
// ============================================================

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../education.db');
let db = null;

function getDB() {
  if (!db) {
    db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY, (err) => {
      if (err) {
        console.error('題庫資料庫連接失敗:', err.message);
      } else {
        console.log('題庫資料庫已連接:', DB_PATH);
      }
    });
  }
  return db;
}

// 查詢封裝
function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDB().all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    getDB().get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

// ============================================================
// 工具函數
// ============================================================

function parseJSON(str) {
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}

function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ============================================================
// 路由：統計
// ============================================================

/**
 * GET /api/quiz/stats
 * 取得題庫統計
 */
router.get('/stats', async (req, res) => {
  try {
    // L1 統計
    const l1 = await dbGet('SELECT COUNT(*) as count FROM curriculum_knowledge_tree');
    
    // L2 統計 (使用 quiz_good_questions 表)
    const l2Total = await dbGet('SELECT COUNT(*) as count FROM quiz_good_questions');
    const l2BySubject = await dbAll(`
      SELECT subject_category as subject, COUNT(*) as count 
      FROM quiz_good_questions 
      WHERE subject_category IS NOT NULL 
      GROUP BY subject_category
    `);
    
    // L3 統計
    const l3Total = await dbGet('SELECT COUNT(*) as count FROM gsat_l3_generated');
    const l3BySubject = await dbAll(`
      SELECT subject, COUNT(*) as count 
      FROM gsat_l3_generated 
      GROUP BY subject
    `);
    
    // 組裝結果
    const subjects = {};
    l2BySubject.forEach(row => {
      subjects[row.subject] = { L2: row.count, L3: 0 };
    });
    l3BySubject.forEach(row => {
      if (!subjects[row.subject]) {
        subjects[row.subject] = { L2: 0, L3: 0 };
      }
      subjects[row.subject].L3 = row.count;
    });
    
    // 計算總數
    Object.keys(subjects).forEach(subj => {
      subjects[subj].total = subjects[subj].L2 + subjects[subj].L3;
    });
    
    res.json({
      success: true,
      data: {
        total: l1.count + l2Total.count + l3Total.count,
        layers: {
          L1_knowledge: l1.count,
          L2_basic: l2Total.count,
          L3_literacy: l3Total.count
        },
        subjects
      }
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/quiz/overview
 * 三層總覽
 */
router.get('/overview', async (req, res) => {
  try {
    const rows = await dbAll(`
      SELECT * FROM three_layer_index ORDER BY l1_node_count DESC
    `);
    
    res.json({
      success: true,
      data: rows.map(row => ({
        subject: row.subject,
        L1: row.l1_node_count,
        L2: row.l2_question_count,
        L3: row.l3_literacy_count,
        total: row.l1_node_count + row.l2_question_count + row.l3_literacy_count
      }))
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// 路由：題目查詢
// ============================================================

/**
 * GET /api/quiz/questions
 * 統一題目查詢
 * 
 * Query params:
 * - level: L2 / L3 / all (default: all)
 * - subject: 科目名稱
 * - difficulty: easy / medium / hard
 * - limit: 數量 (default: 20, max: 100)
 */
router.get('/questions', async (req, res) => {
  try {
    const { level = 'all', subject, difficulty, limit = 20 } = req.query;
    const maxLimit = Math.min(parseInt(limit), 100);
    
    let questions = [];
    
    // L2 查詢 (使用 quiz_good_questions 表)
    if (level === 'L2' || level === 'all') {
      let sql = 'SELECT * FROM quiz_good_questions WHERE 1=1';
      const params = [];
      
      if (subject) {
        sql += ' AND (subject_category = ? OR subject = ?)';
        params.push(subject, subject);
      }
      if (difficulty) {
        sql += ' AND difficulty = ?';
        params.push(difficulty);
      }
      
      sql += ' ORDER BY RANDOM() LIMIT ?';
      params.push(level === 'all' ? Math.ceil(maxLimit / 2) : maxLimit);
      
      const rows = await dbAll(sql, params);
      questions.push(...rows.map(row => ({
        id: row.id,
        level: 'L2',
        subject: row.subject_category || row.subject,
        node_id: row.node_id,
        question: row.question,
        options: parseJSON(row.options),
        answer: row.answer,
        explanation: row.explanation,
        difficulty: row.difficulty,
        mnemonic: row.mnemonic
      })));
    }
    
    // L3 查詢
    if (level === 'L3' || level === 'all') {
      let sql = 'SELECT * FROM gsat_l3_generated WHERE 1=1';
      const params = [];
      
      if (subject) {
        sql += ' AND subject = ?';
        params.push(subject);
      }
      
      // 難度映射
      if (difficulty) {
        const levelMap = { easy: 'basic', medium: 'apply', hard: 'extend' };
        sql += ' AND question_level = ?';
        params.push(levelMap[difficulty] || difficulty);
      }
      
      sql += ' ORDER BY RANDOM() LIMIT ?';
      params.push(level === 'all' ? Math.ceil(maxLimit / 2) : maxLimit);
      
      const rows = await dbAll(sql, params);
      questions.push(...rows.map(row => ({
        id: row.id,
        level: 'L3',
        subject: row.subject,
        node_id: row.node_id,
        question: row.question_text,
        options: parseJSON(row.options),
        answer: row.answer,
        explanation: row.explanation,
        difficulty: row.question_level,
        context: row.context_type
      })));
    }
    
    // 打亂並限制數量
    questions = shuffleArray(questions).slice(0, maxLimit);
    
    res.json({
      success: true,
      data: {
        count: questions.length,
        questions
      }
    });
  } catch (err) {
    console.error('Questions error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/quiz/l2
 * L2 基礎題查詢
 */
router.get('/l2', async (req, res) => {
  try {
    const { subject, node_id, difficulty, limit = 20 } = req.query;
    const maxLimit = Math.min(parseInt(limit), 100);
    
    let sql = 'SELECT * FROM quiz_good_questions WHERE 1=1';
    const params = [];
    
    if (subject) {
      sql += ' AND (subject_category = ? OR subject = ?)';
      params.push(subject, subject);
    }
    if (node_id) {
      sql += ' AND node_id LIKE ?';
      params.push(`${node_id}%`);
    }
    if (difficulty) {
      sql += ' AND difficulty = ?';
      params.push(difficulty);
    }
    
    sql += ' ORDER BY RANDOM() LIMIT ?';
    params.push(maxLimit);
    
    const rows = await dbAll(sql, params);
    
    res.json({
      success: true,
      data: {
        count: rows.length,
        questions: rows.map(row => ({
          id: row.id,
          level: 'L2',
          subject: row.subject_category || row.subject,
          node_id: row.node_id,
          question: row.question,
          options: parseJSON(row.options),
          answer: row.answer,
          explanation: row.explanation,
          difficulty: row.difficulty,
          mnemonic: row.mnemonic
        }))
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/quiz/l3
 * L3 素養題查詢
 */
router.get('/l3', async (req, res) => {
  try {
    const { subject, node_id, question_level, limit = 20 } = req.query;
    const maxLimit = Math.min(parseInt(limit), 100);
    
    let sql = 'SELECT * FROM gsat_l3_generated WHERE 1=1';
    const params = [];
    
    if (subject) {
      sql += ' AND subject = ?';
      params.push(subject);
    }
    if (node_id) {
      sql += ' AND node_id LIKE ?';
      params.push(`${node_id}%`);
    }
    if (question_level) {
      sql += ' AND question_level = ?';
      params.push(question_level);
    }
    
    sql += ' ORDER BY RANDOM() LIMIT ?';
    params.push(maxLimit);
    
    const rows = await dbAll(sql, params);
    
    res.json({
      success: true,
      data: {
        count: rows.length,
        questions: rows.map(row => ({
          id: row.id,
          level: 'L3',
          subject: row.subject,
          node_id: row.node_id,
          question: row.question_text,
          options: parseJSON(row.options),
          answer: row.answer,
          explanation: row.explanation,
          question_level: row.question_level,
          context: row.context_type
        }))
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// 路由：測驗
// ============================================================

/**
 * POST /api/quiz/create
 * 創建測驗
 * 
 * Body:
 * - subject: 科目
 * - num_questions: 題數 (default: 10)
 * - level: L2 / L3 / all
 */
router.post('/create', async (req, res) => {
  try {
    const { subject, num_questions = 10, level = 'all' } = req.body;
    
    if (!subject) {
      return res.status(400).json({ success: false, error: 'Subject required' });
    }
    
    const maxQ = Math.min(parseInt(num_questions), 50);
    let questions = [];
    
    // L2 題目 (使用 quiz_good_questions)
    if (level === 'L2' || level === 'all') {
      const l2Count = level === 'all' ? Math.ceil(maxQ * 0.6) : maxQ;
      const l2Rows = await dbAll(`
        SELECT * FROM quiz_good_questions 
        WHERE subject_category = ? OR subject = ?
        ORDER BY RANDOM() 
        LIMIT ?
      `, [subject, subject, l2Count]);
      
      questions.push(...l2Rows.map(row => ({
        id: row.id,
        level: 'L2',
        question: row.question,
        options: parseJSON(row.options),
        answer: row.answer,
        mnemonic: row.mnemonic
      })));
    }
    
    // L3 題目
    if (level === 'L3' || level === 'all') {
      const l3Count = level === 'all' ? Math.ceil(maxQ * 0.4) : maxQ;
      const l3Rows = await dbAll(`
        SELECT * FROM gsat_l3_generated 
        WHERE subject = ? 
        ORDER BY RANDOM() 
        LIMIT ?
      `, [subject, l3Count]);
      
      questions.push(...l3Rows.map(row => ({
        id: row.id,
        level: 'L3',
        question: row.question_text,
        options: parseJSON(row.options),
        answer: row.answer
      })));
    }
    
    // 打亂
    questions = shuffleArray(questions).slice(0, maxQ);
    
    // 生成 Session ID
    const sessionId = `quiz_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    res.json({
      success: true,
      data: {
        session_id: sessionId,
        subject,
        total_questions: questions.length,
        questions: questions.map((q, i) => ({
          index: i + 1,
          ...q,
          answer: undefined // 不返回答案
        })),
        // 答案分開存儲（實際應存入 session/redis）
        _answers: questions.map(q => q.answer)
      }
    });
  } catch (err) {
    console.error('Create quiz error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/quiz/check
 * 檢查答案
 * 
 * Body:
 * - question_id: 題目ID
 * - level: L2 / L3
 * - answer: 用戶答案
 */
router.post('/check', async (req, res) => {
  try {
    const { question_id, level, answer } = req.body;
    
    if (!question_id || !level || !answer) {
      return res.status(400).json({ success: false, error: 'Missing parameters' });
    }
    
    let row;
    if (level === 'L2') {
      row = await dbGet('SELECT answer, explanation, mnemonic FROM quiz_good_questions WHERE id = ?', [question_id]);
    } else {
      row = await dbGet('SELECT answer, explanation FROM gsat_l3_generated WHERE id = ?', [question_id]);
    }
    
    if (!row) {
      return res.status(404).json({ success: false, error: 'Question not found' });
    }
    
    const isCorrect = parseInt(answer) === row.answer;
    
    res.json({
      success: true,
      data: {
        question_id,
        your_answer: parseInt(answer),
        correct_answer: row.answer,
        is_correct: isCorrect,
        explanation: row.explanation
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// 路由：學習路徑
// ============================================================

/**
 * GET /api/quiz/path/:subject
 * 取得學習路徑推薦
 */
router.get('/path/:subject', async (req, res) => {
  try {
    const { subject } = req.params;
    
    // L1 知識點
    const l1Count = await dbGet(`
      SELECT COUNT(*) as count FROM curriculum_knowledge_tree WHERE subject_name = ?
    `, [subject]);
    
    // L2 題目
    const l2Count = await dbGet(`
      SELECT COUNT(*) as count FROM quiz_good_questions WHERE subject_category = ? OR subject = ?
    `, [subject, subject]);
    
    // L3 題目
    const l3Count = await dbGet(`
      SELECT COUNT(*) as count FROM gsat_l3_generated WHERE subject = ?
    `, [subject]);
    
    res.json({
      success: true,
      data: {
        subject,
        stages: [
          {
            stage: 1,
            name: '知識學習',
            type: 'L1',
            items: l1Count?.count || 0,
            description: `學習 ${subject} 基礎知識點`
          },
          {
            stage: 2,
            name: '基礎練習',
            type: 'L2',
            items: l2Count?.count || 0,
            description: '完成基礎題目鞏固知識'
          },
          {
            stage: 3,
            name: '素養提升',
            type: 'L3',
            items: l3Count?.count || 0,
            description: '挑戰素養導向題目'
          }
        ]
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/quiz/subjects
 * 取得科目列表
 */
router.get('/subjects', async (req, res) => {
  try {
    const rows = await dbAll(`
      SELECT DISTINCT subject FROM gsat_l3_generated WHERE subject IS NOT NULL
    `);
    
    res.json({
      success: true,
      data: {
        subjects: rows.map(r => r.subject).sort()
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// 導出
// ============================================================

module.exports = router;

// ============================================================
// 新增路由：學測題庫 (quiz_good_questions)
// ============================================================

/**
 * GET /api/quiz/gsat
 * 學測題庫查詢 (支援科目篩選)
 * 
 * Query params:
 * - subject: 數學/物理/化學/生物/地科/國文/英文/歷史/地理/公民
 * - difficulty: 1/2/3
 * - limit: 數量 (default: 10, max: 50)
 * - random: true/false (default: true)
 */
router.get('/gsat', async (req, res) => {
  try {
    const { subject, difficulty, limit = 10, random = 'true' } = req.query;
    const maxLimit = Math.min(parseInt(limit), 50);
    
    let sql = `
      SELECT id, node_id, subject_category as subject, subject as topic,
             question, options, answer, explanation, difficulty, mnemonic
      FROM quiz_good_questions
      WHERE subject_category IS NOT NULL
    `;
    const params = [];
    
    if (subject) {
      sql += ' AND subject_category = ?';
      params.push(subject);
    }
    if (difficulty) {
      sql += ' AND difficulty = ?';
      params.push(parseInt(difficulty));
    }
    
    if (random === 'true') {
      sql += ' ORDER BY RANDOM()';
    } else {
      sql += ' ORDER BY id';
    }
    
    sql += ' LIMIT ?';
    params.push(maxLimit);
    
    const rows = await dbAll(sql, params);
    
    // 格式化選項
    const questions = rows.map(row => ({
      id: row.id,
      node_id: row.node_id,
      subject: row.subject,
      topic: row.topic,
      text: row.question,
      options: parseJSON(row.options),
      answer: row.answer,
      explanation: row.explanation,
      difficulty: row.difficulty,
      mnemonic: row.mnemonic
    }));
    
    res.json({
      success: true,
      count: questions.length,
      data: questions
    });
  } catch (err) {
    console.error('GSAT query error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/quiz/gsat/subjects
 * 學測題庫科目統計
 */
router.get('/gsat/subjects', async (req, res) => {
  try {
    const rows = await dbAll(`
      SELECT subject_category as subject, COUNT(*) as count
      FROM quiz_good_questions
      WHERE subject_category IS NOT NULL
      GROUP BY subject_category
      ORDER BY count DESC
    `);
    
    const total = rows.reduce((sum, r) => sum + r.count, 0);
    
    res.json({
      success: true,
      total,
      data: rows
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/quiz/xtf/:nodeId
 * 取得 XTF 知識節點詳情
 */
router.get('/xtf/:nodeId', async (req, res) => {
  try {
    const { nodeId } = req.params;
    
    const node = await dbGet(`
      SELECT * FROM xtf_nodes_v2 WHERE node_id = ?
    `, [nodeId]);
    
    if (!node) {
      return res.status(404).json({ success: false, error: '節點不存在' });
    }
    
    // 格式化 XTF 三層
    const xtf = {
      node_id: node.node_id,
      subject: node.subject_name,
      name: node.node_name,
      // X 層 (消化理解)
      x: {
        definition: node.definition,
        plain: node.plain,
        analogy: node.etymology,
        understand: node.understand
      },
      // T 層 (拓展結構)
      t: {
        prerequisites: parseJSON(node.prerequisites),
        next_nodes: parseJSON(node.next_nodes),
        related: parseJSON(node.related),
        confused_with: parseJSON(node.confused_with),
        pivots: node.pivots
      },
      // F 層 (融會應用)
      f: {
        memorize: node.memorize,
        apply: node.apply
      },
      meta: {
        difficulty: node.difficulty,
        importance: node.importance,
        grade: node.grade
      }
    };
    
    res.json({
      success: true,
      data: xtf
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/quiz/xtf-list
 * XTF 節點列表 (支援科目篩選)
 */
router.get('/xtf-list', async (req, res) => {
  try {
    const { subject, limit = 50 } = req.query;
    const maxLimit = Math.min(parseInt(limit), 200);
    
    let sql = `
      SELECT node_id, subject_name, node_name, plain, 
             difficulty, importance, pivots
      FROM xtf_nodes_v2
      WHERE 1=1
    `;
    const params = [];
    
    if (subject) {
      sql += ' AND subject_name = ?';
      params.push(subject);
    }
    
    sql += ' ORDER BY importance DESC LIMIT ?';
    params.push(maxLimit);
    
    const rows = await dbAll(sql, params);
    
    res.json({
      success: true,
      count: rows.length,
      data: rows.map(r => ({
        node_id: r.node_id,
        subject: r.subject_name,
        name: r.node_name,
        plain: r.plain,
        difficulty: r.difficulty,
        importance: r.importance,
        is_hub: r.pivots && r.pivots !== '[]'
      }))
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/quiz/relations/:nodeId
 * 取得節點關聯 (XTF Chain)
 */
router.get('/relations/:nodeId', async (req, res) => {
  try {
    const { nodeId } = req.params;
    
    const node = await dbGet(`
      SELECT node_id, subject_name, node_name, prerequisites, 
             next_nodes, related, confused_with
      FROM xtf_nodes_v2 WHERE node_id = ?
    `, [nodeId]);
    
    if (!node) {
      return res.status(404).json({ success: false, error: '節點不存在' });
    }
    
    // 解析關聯
    const prereqs = parseJSON(node.prerequisites) || [];
    const nexts = parseJSON(node.next_nodes) || [];
    const related = parseJSON(node.related) || [];
    const confused = parseJSON(node.confused_with) || [];
    
    // 查詢關聯節點名稱
    const allIds = [...prereqs, ...nexts, ...related, ...confused];
    let relatedNodes = {};
    
    if (allIds.length > 0) {
      const placeholders = allIds.map(() => '?').join(',');
      const rows = await dbAll(`
        SELECT node_id, node_name, subject_name 
        FROM xtf_nodes_v2 
        WHERE node_id IN (${placeholders})
      `, allIds);
      
      rows.forEach(r => {
        relatedNodes[r.node_id] = { name: r.node_name, subject: r.subject_name };
      });
    }
    
    res.json({
      success: true,
      data: {
        node_id: node.node_id,
        name: node.node_name,
        subject: node.subject_name,
        chain: {
          prerequisites: prereqs.map(id => ({ id, ...relatedNodes[id] })),
          next_nodes: nexts.map(id => ({ id, ...relatedNodes[id] })),
          related: related.map(id => ({ id, ...relatedNodes[id] })),
          confused_with: confused.map(id => ({ id, ...relatedNodes[id] }))
        }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});
