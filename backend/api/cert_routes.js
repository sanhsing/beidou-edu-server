/**
 * 北斗教育證照考試 API 路由
 * AI 證照 + iPAS 資安工程師
 * 2025-12-15
 */

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const router = express.Router();

// ============================================================
// 資料庫連接
// ============================================================

const DB_PATH = process.env.EDUCATION_DB_PATH || path.join(__dirname, '../education.db');
let db = null;

function getDB() {
  if (!db) {
    db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY, (err) => {
      if (err) console.error('證照資料庫連接失敗:', err.message);
      else console.log('證照資料庫已連接');
    });
  }
  return db;
}

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

function parseJSON(str) {
  try { return JSON.parse(str); } catch { return str; }
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ============================================================
// 證照考試配置
// ============================================================

const EXAM_CONFIG = {
  // AI 證照
  'CERT001': { // Google AI Essentials
    name: 'Google AI Essentials',
    name_zh: 'Google AI 基礎',
    questions: 25,
    duration: 30, // 分鐘
    passing: 80,  // 百分比
    domains: ['D001', 'D002', 'D003', 'D004', 'D005']
  },
  'CERT002': { // AWS AI Practitioner
    name: 'AWS AI Practitioner',
    name_zh: 'AWS AI 從業者',
    questions: 65,
    duration: 90,
    passing: 70,
    domains: ['A01', 'A02', 'A03', 'A04']
  },
  'CERT003': { // Azure AI-900
    name: 'Microsoft AI-900',
    name_zh: 'Azure AI 基礎',
    questions: 45,
    duration: 45,
    passing: 70,
    domains: ['M01', 'M02', 'M03', 'M04', 'M05']
  },
  // iPAS 資安
  'IPAS_ISE_BASIC': {
    name: 'iPAS 資安工程師初級',
    name_zh: 'iPAS 資安工程師初級',
    questions: 50,
    duration: 60,
    passing: 70,
    domains: ['ISE_B_MGT', 'ISE_B_TECH']
  },
  'IPAS_ISE_INTER': {
    name: 'iPAS 資安工程師中級',
    name_zh: 'iPAS 資安工程師中級',
    questions: 50,
    duration: 60,
    passing: 70,
    domains: ['ISE_I_PLAN', 'ISE_I_DEF']
  }
};

// ============================================================
// 路由：證照列表
// ============================================================

/**
 * GET /api/cert/list
 * 取得所有證照列表
 */
router.get('/list', async (req, res) => {
  try {
    // AI 證照
    const aiCerts = await dbAll('SELECT * FROM ai_certifications');
    
    // iPAS 證照
    const ipasCerts = await dbAll('SELECT * FROM ipas_certifications');
    
    // 題目統計
    const aiStats = await dbAll(`
      SELECT cert_id, COUNT(*) as count 
      FROM ai_cert_questions 
      GROUP BY cert_id
    `);
    const aiStatsMap = {};
    aiStats.forEach(r => aiStatsMap[r.cert_id] = r.count);
    
    const ipasStats = await dbAll(`
      SELECT cert_id, COUNT(*) as count 
      FROM ipas_ise_questions 
      GROUP BY cert_id
    `);
    const ipasStatsMap = {};
    ipasStats.forEach(r => ipasStatsMap[r.cert_id] = r.count);
    
    res.json({
      success: true,
      data: {
        ai_certifications: aiCerts.map(c => ({
          ...c,
          question_count: aiStatsMap[c.cert_id] || 0,
          exam_config: EXAM_CONFIG[c.cert_id] || null
        })),
        ipas_certifications: ipasCerts.map(c => ({
          ...c,
          question_count: ipasStatsMap[c.cert_id] || 0,
          exam_config: EXAM_CONFIG[c.cert_id] || null
        })),
        total_questions: Object.values(aiStatsMap).reduce((a, b) => a + b, 0) +
                        Object.values(ipasStatsMap).reduce((a, b) => a + b, 0)
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/cert/stats
 * 證照題庫統計
 */
router.get('/stats', async (req, res) => {
  try {
    const aiTotal = await dbGet('SELECT COUNT(*) as count FROM ai_cert_questions');
    const ipasTotal = await dbGet('SELECT COUNT(*) as count FROM ipas_ise_questions');
    
    const aiByDomain = await dbAll(`
      SELECT domain_id, COUNT(*) as count 
      FROM ai_cert_questions 
      GROUP BY domain_id 
      ORDER BY count DESC
    `);
    
    const ipasByDomain = await dbAll(`
      SELECT domain_id, COUNT(*) as count 
      FROM ipas_ise_questions 
      GROUP BY domain_id 
      ORDER BY count DESC
    `);
    
    res.json({
      success: true,
      data: {
        total: aiTotal.count + ipasTotal.count,
        ai_cert: {
          total: aiTotal.count,
          by_domain: aiByDomain
        },
        ipas: {
          total: ipasTotal.count,
          by_domain: ipasByDomain
        }
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// 路由：題目查詢
// ============================================================

/**
 * GET /api/cert/questions/:certId
 * 查詢特定證照題目
 */
router.get('/questions/:certId', async (req, res) => {
  try {
    const { certId } = req.params;
    const { domain, limit = 20, random = 'true' } = req.query;
    const maxLimit = Math.min(parseInt(limit), 100);
    
    let questions = [];
    
    // 判斷是 AI 證照還是 iPAS
    if (certId.startsWith('IPAS')) {
      let sql = 'SELECT * FROM ipas_ise_questions WHERE cert_id = ?';
      const params = [certId];
      
      if (domain) {
        sql += ' AND domain_id LIKE ?';
        params.push(`${domain}%`);
      }
      
      if (random === 'true') sql += ' ORDER BY RANDOM()';
      sql += ' LIMIT ?';
      params.push(maxLimit);
      
      const rows = await dbAll(sql, params);
      questions = rows.map(r => ({
        id: r.question_id,
        cert_id: r.cert_id,
        domain_id: r.domain_id,
        type: r.question_type,
        difficulty: r.difficulty,
        question: r.question_text,
        options: parseJSON(r.options),
        answer: r.answer,
        explanation: r.explanation
      }));
    } else {
      let sql = 'SELECT * FROM ai_cert_questions WHERE cert_id = ?';
      const params = [certId];
      
      if (domain) {
        sql += ' AND domain_id LIKE ?';
        params.push(`${domain}%`);
      }
      
      if (random === 'true') sql += ' ORDER BY RANDOM()';
      sql += ' LIMIT ?';
      params.push(maxLimit);
      
      const rows = await dbAll(sql, params);
      questions = rows.map(r => ({
        id: r.question_id,
        cert_id: r.cert_id,
        domain_id: r.domain_id,
        type: r.question_type,
        difficulty: r.difficulty,
        question: r.question_text,
        options: parseJSON(r.options),
        answer: r.answer,
        explanation: r.explanation
      }));
    }
    
    res.json({
      success: true,
      data: {
        cert_id: certId,
        count: questions.length,
        questions
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// 路由：模擬考試
// ============================================================

/**
 * POST /api/cert/exam/start
 * 開始模擬考試
 * 
 * Body:
 * - cert_id: 證照代碼
 * - mode: 'full' | 'practice' | 'quick'
 */
router.post('/exam/start', async (req, res) => {
  try {
    const { cert_id, mode = 'practice' } = req.body;
    
    if (!cert_id) {
      return res.status(400).json({ success: false, error: 'cert_id required' });
    }
    
    const config = EXAM_CONFIG[cert_id];
    if (!config) {
      return res.status(400).json({ success: false, error: 'Invalid cert_id' });
    }
    
    // 決定題數
    let numQuestions;
    switch (mode) {
      case 'full': numQuestions = config.questions; break;
      case 'quick': numQuestions = 10; break;
      case 'practice': 
      default: numQuestions = Math.min(20, config.questions); break;
    }
    
    // 取得題目
    let questions = [];
    const isIPAS = cert_id.startsWith('IPAS');
    
    if (isIPAS) {
      const rows = await dbAll(`
        SELECT * FROM ipas_ise_questions 
        WHERE cert_id = ? 
        ORDER BY RANDOM() 
        LIMIT ?
      `, [cert_id, numQuestions]);
      
      questions = rows.map((r, i) => ({
        index: i + 1,
        id: r.question_id,
        domain_id: r.domain_id,
        question: r.question_text,
        options: parseJSON(r.options),
        type: r.question_type
      }));
    } else {
      const rows = await dbAll(`
        SELECT * FROM ai_cert_questions 
        WHERE cert_id = ? 
        ORDER BY RANDOM() 
        LIMIT ?
      `, [cert_id, numQuestions]);
      
      questions = rows.map((r, i) => ({
        index: i + 1,
        id: r.question_id,
        domain_id: r.domain_id,
        question: r.question_text,
        options: parseJSON(r.options),
        type: r.question_type
      }));
    }
    
    // 生成考試 Session
    const examId = `exam_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const startTime = new Date().toISOString();
    
    // 存儲答案 (實際應存入 Redis/Session)
    const answers = {};
    if (isIPAS) {
      const answerRows = await dbAll(`
        SELECT question_id, answer FROM ipas_ise_questions 
        WHERE question_id IN (${questions.map(q => `'${q.id}'`).join(',')})
      `);
      answerRows.forEach(r => answers[r.question_id] = r.answer);
    } else {
      const answerRows = await dbAll(`
        SELECT question_id, answer FROM ai_cert_questions 
        WHERE question_id IN (${questions.map(q => `'${q.id}'`).join(',')})
      `);
      answerRows.forEach(r => answers[r.question_id] = r.answer);
    }
    
    res.json({
      success: true,
      data: {
        exam_id: examId,
        cert_id,
        cert_name: config.name_zh,
        mode,
        start_time: startTime,
        duration_minutes: mode === 'full' ? config.duration : Math.ceil(numQuestions * 1.5),
        passing_score: config.passing,
        total_questions: questions.length,
        questions,
        // 實際部署時不應返回答案，這裡僅供測試
        _answers: answers
      }
    });
  } catch (err) {
    console.error('Exam start error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/cert/exam/submit
 * 提交考試答案
 * 
 * Body:
 * - exam_id: 考試ID
 * - cert_id: 證照代碼
 * - answers: { question_id: answer }
 */
router.post('/exam/submit', async (req, res) => {
  try {
    const { exam_id, cert_id, answers } = req.body;
    
    if (!exam_id || !cert_id || !answers) {
      return res.status(400).json({ success: false, error: 'Missing parameters' });
    }
    
    const config = EXAM_CONFIG[cert_id];
    const isIPAS = cert_id.startsWith('IPAS');
    
    // 取得正確答案
    const questionIds = Object.keys(answers);
    let correctAnswers = {};
    let explanations = {};
    
    if (isIPAS) {
      const rows = await dbAll(`
        SELECT question_id, answer, explanation, domain_id 
        FROM ipas_ise_questions 
        WHERE question_id IN (${questionIds.map(id => `'${id}'`).join(',')})
      `);
      rows.forEach(r => {
        correctAnswers[r.question_id] = r.answer;
        explanations[r.question_id] = { explanation: r.explanation, domain: r.domain_id };
      });
    } else {
      const rows = await dbAll(`
        SELECT question_id, answer, explanation, domain_id 
        FROM ai_cert_questions 
        WHERE question_id IN (${questionIds.map(id => `'${id}'`).join(',')})
      `);
      rows.forEach(r => {
        correctAnswers[r.question_id] = r.answer;
        explanations[r.question_id] = { explanation: r.explanation, domain: r.domain_id };
      });
    }
    
    // 計算成績
    let correct = 0;
    let wrong = 0;
    const results = [];
    const domainStats = {};
    
    questionIds.forEach(qId => {
      const userAnswer = answers[qId];
      const correctAnswer = correctAnswers[qId];
      const isCorrect = userAnswer === correctAnswer;
      const domain = explanations[qId]?.domain || 'unknown';
      
      if (isCorrect) correct++;
      else wrong++;
      
      // 領域統計
      if (!domainStats[domain]) domainStats[domain] = { correct: 0, total: 0 };
      domainStats[domain].total++;
      if (isCorrect) domainStats[domain].correct++;
      
      results.push({
        question_id: qId,
        your_answer: userAnswer,
        correct_answer: correctAnswer,
        is_correct: isCorrect,
        explanation: explanations[qId]?.explanation || '',
        domain
      });
    });
    
    const total = questionIds.length;
    const score = Math.round((correct / total) * 100);
    const passed = score >= (config?.passing || 70);
    
    res.json({
      success: true,
      data: {
        exam_id,
        cert_id,
        cert_name: config?.name_zh || cert_id,
        score,
        passed,
        passing_score: config?.passing || 70,
        correct,
        wrong,
        total,
        domain_stats: Object.entries(domainStats).map(([domain, stats]) => ({
          domain,
          correct: stats.correct,
          total: stats.total,
          percentage: Math.round((stats.correct / stats.total) * 100)
        })),
        results
      }
    });
  } catch (err) {
    console.error('Exam submit error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/cert/check
 * 單題檢查
 */
router.post('/check', async (req, res) => {
  try {
    const { question_id, answer, cert_type = 'ai' } = req.body;
    
    let row;
    if (cert_type === 'ipas') {
      row = await dbGet(
        'SELECT answer, explanation FROM ipas_ise_questions WHERE question_id = ?',
        [question_id]
      );
    } else {
      row = await dbGet(
        'SELECT answer, explanation FROM ai_cert_questions WHERE question_id = ?',
        [question_id]
      );
    }
    
    if (!row) {
      return res.status(404).json({ success: false, error: 'Question not found' });
    }
    
    const isCorrect = answer === row.answer;
    
    res.json({
      success: true,
      data: {
        question_id,
        your_answer: answer,
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
// 路由：領域與知識點
// ============================================================

/**
 * GET /api/cert/domains/:certId
 * 取得證照考試領域
 */
router.get('/domains/:certId', async (req, res) => {
  try {
    const { certId } = req.params;
    
    let domains = [];
    
    if (certId.startsWith('IPAS')) {
      domains = await dbAll(`
        SELECT d.*, COUNT(q.question_id) as question_count
        FROM ipas_ise_domains d
        LEFT JOIN ipas_ise_questions q ON d.domain_id = q.domain_id
        WHERE d.cert_id = ?
        GROUP BY d.domain_id
      `, [certId]);
    } else {
      domains = await dbAll(`
        SELECT d.*, COUNT(q.question_id) as question_count
        FROM ai_cert_exam_domains d
        LEFT JOIN ai_cert_questions q ON d.domain_id = q.domain_id
        WHERE d.cert_id = ?
        GROUP BY d.domain_id
      `, [certId]);
    }
    
    res.json({
      success: true,
      data: {
        cert_id: certId,
        domains
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/cert/glossary/:certId
 * 取得術語表
 */
router.get('/glossary/:certId', async (req, res) => {
  try {
    const { certId } = req.params;
    const { limit = 50 } = req.query;
    
    const terms = await dbAll(`
      SELECT * FROM ai_cert_glossary 
      WHERE cert_id = ? 
      ORDER BY term 
      LIMIT ?
    `, [certId, parseInt(limit)]);
    
    res.json({
      success: true,
      data: {
        cert_id: certId,
        count: terms.length,
        terms
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================
// 路由：XTF-KG 知識圖譜
// ============================================================

// 導入診斷引擎
const { diagnoseHandler, recommendHandler } = require('./diagnosis_engine');

// 導入複習引擎
const { 
  recordReviewHandler, 
  getDueReviewsHandler, 
  getReviewStatsHandler,
  getReviewCalendarHandler 
} = require('./review_engine');

/**
 * POST /api/cert/review/record
 * 記錄複習結果
 */
router.post('/review/record', async (req, res) => {
  await recordReviewHandler(req, res, getDB());
});

/**
 * GET /api/cert/review/due/:userId
 * 獲取待複習項目
 */
router.get('/review/due/:userId', async (req, res) => {
  await getDueReviewsHandler(req, res, getDB());
});

/**
 * GET /api/cert/review/stats/:userId
 * 獲取複習統計
 */
router.get('/review/stats/:userId', async (req, res) => {
  await getReviewStatsHandler(req, res, getDB());
});

/**
 * GET /api/cert/review/calendar/:userId
 * 獲取複習日曆
 */
router.get('/review/calendar/:userId', async (req, res) => {
  await getReviewCalendarHandler(req, res, getDB());
});

/**
 * POST /api/cert/diagnose
 * 弱點診斷
 */
router.post('/diagnose', async (req, res) => {
  await diagnoseHandler(req, res, getDB());
});

/**
 * GET /api/cert/recommend/:nodeId
 * 學習推薦
 */
router.get('/recommend/:nodeId', async (req, res) => {
  await recommendHandler(req, res, getDB());
});

/**
 * GET /api/cert/xtf/:certId/:nodeId
 * 取得 XTF 增強知識
 */
router.get('/xtf/:certId/:nodeId', async (req, res) => {
  try {
    const { certId, nodeId } = req.params;
    
    let row;
    if (certId.startsWith('IPAS')) {
      row = await dbGet(`
        SELECT * FROM ipas_xtf_knowledge WHERE node_id = ?
      `, [nodeId]);
    } else {
      row = await dbGet(`
        SELECT * FROM ai_cert_xtf_knowledge WHERE node_id = ?
      `, [nodeId]);
    }
    
    if (!row) {
      return res.status(404).json({ success: false, error: 'XTF knowledge not found' });
    }
    
    // 格式化輸出
    const xtf = {
      node_id: row.node_id,
      cert_id: row.cert_id,
      // X 層 (理解)
      x_layer: {
        definition: row.x_definition,
        plain: row.x_plain,
        analogy: row.x_analogy,
        key_formula: row.x_key_formula || row.x_key_points
      },
      // T 層 (結構)
      t_layer: {
        prerequisites: parseJSON(row.t_prerequisites),
        next_nodes: parseJSON(row.t_next_nodes),
        related: parseJSON(row.t_related),
        confused_with: parseJSON(row.t_confused_with),
        hub_score: row.t_hub_score
      },
      // F 層 (應用)
      f_layer: {
        exam_tips: row.f_exam_tips,
        mnemonics: row.f_mnemonics,
        real_world: row.f_real_world,
        question_ids: parseJSON(row.f_question_ids),
        attack_defense: row.f_attack_defense ? parseJSON(row.f_attack_defense) : null
      },
      meta: {
        importance: row.importance,
        difficulty: row.difficulty
      }
    };
    
    res.json({ success: true, data: xtf });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/cert/xtf-list/:certId
 * 取得證照所有 XTF 知識列表
 */
router.get('/xtf-list/:certId', async (req, res) => {
  try {
    const { certId } = req.params;
    
    let rows;
    if (certId.startsWith('IPAS')) {
      rows = await dbAll(`
        SELECT node_id, cert_id, domain_id, x_plain, f_mnemonics, t_hub_score, importance
        FROM ipas_xtf_knowledge 
        WHERE cert_id = ?
        ORDER BY t_hub_score DESC
      `, [certId]);
    } else {
      rows = await dbAll(`
        SELECT node_id, cert_id, x_plain, f_mnemonics, t_hub_score, importance
        FROM ai_cert_xtf_knowledge 
        WHERE cert_id = ?
        ORDER BY t_hub_score DESC
      `, [certId]);
    }
    
    res.json({
      success: true,
      data: {
        cert_id: certId,
        count: rows.length,
        nodes: rows
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/cert/relations/:nodeId
 * 取得節點關係
 */
router.get('/relations/:nodeId', async (req, res) => {
  try {
    const { nodeId } = req.params;
    
    const outgoing = await dbAll(`
      SELECT * FROM cert_knowledge_relations WHERE source_node = ?
    `, [nodeId]);
    
    const incoming = await dbAll(`
      SELECT * FROM cert_knowledge_relations WHERE target_node = ?
    `, [nodeId]);
    
    res.json({
      success: true,
      data: {
        node_id: nodeId,
        outgoing: outgoing.map(r => ({
          target: r.target_node,
          type: r.relation_type,
          weight: r.weight,
          description: r.description
        })),
        incoming: incoming.map(r => ({
          source: r.source_node,
          type: r.relation_type,
          weight: r.weight,
          description: r.description
        }))
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/cert/learning-path/:pathId
 * 取得學習路徑
 */
router.get('/learning-path/:pathId', async (req, res) => {
  try {
    const { pathId } = req.params;
    
    const path = await dbGet(`
      SELECT * FROM cert_learning_paths WHERE path_id = ?
    `, [pathId]);
    
    if (!path) {
      return res.status(404).json({ success: false, error: 'Learning path not found' });
    }
    
    res.json({
      success: true,
      data: {
        ...path,
        node_sequence: parseJSON(path.node_sequence)
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/cert/learning-paths
 * 取得所有學習路徑
 */
router.get('/learning-paths', async (req, res) => {
  try {
    const { cert_id } = req.query;
    
    let sql = 'SELECT * FROM cert_learning_paths';
    const params = [];
    
    if (cert_id) {
      sql += ' WHERE cert_id = ?';
      params.push(cert_id);
    }
    
    const paths = await dbAll(sql, params);
    
    res.json({
      success: true,
      data: {
        count: paths.length,
        paths: paths.map(p => ({
          ...p,
          node_sequence: parseJSON(p.node_sequence)
        }))
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/cert/hub-nodes/:certId
 * 取得樞紐節點
 */
router.get('/hub-nodes/:certId', async (req, res) => {
  try {
    const { certId } = req.params;
    const { min_score = 80 } = req.query;
    
    let rows;
    if (certId.startsWith('IPAS')) {
      rows = await dbAll(`
        SELECT node_id, x_plain, f_mnemonics, t_hub_score, importance
        FROM ipas_xtf_knowledge 
        WHERE cert_id = ? AND t_hub_score >= ?
        ORDER BY t_hub_score DESC
      `, [certId, parseInt(min_score)]);
    } else {
      rows = await dbAll(`
        SELECT node_id, x_plain, f_mnemonics, t_hub_score, importance
        FROM ai_cert_xtf_knowledge 
        WHERE cert_id = ? AND t_hub_score >= ?
        ORDER BY t_hub_score DESC
      `, [certId, parseInt(min_score)]);
    }
    
    res.json({
      success: true,
      data: {
        cert_id: certId,
        min_score: parseInt(min_score),
        count: rows.length,
        hub_nodes: rows
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
// 新增路由：證照統計與題目查詢
// ============================================================

/**
 * GET /api/cert/stats
 * 證照題庫統計
 */
router.get('/stats', async (req, res) => {
  try {
    // AI 證照統計
    const aiCert = await dbAll(`
      SELECT cert_id, COUNT(*) as count
      FROM ai_cert_questions
      GROUP BY cert_id
    `);
    
    // iPAS 統計
    const ipas = await dbGet(`
      SELECT COUNT(*) as count FROM ipas_ise_questions
    `);
    
    const stats = {
      google: 0,
      aws: 0,
      azure: 0,
      ipas: ipas?.count || 0
    };
    
    aiCert.forEach(row => {
      const key = row.cert_id?.toLowerCase();
      if (stats.hasOwnProperty(key)) {
        stats[key] = row.count;
      }
    });
    
    res.json({
      success: true,
      data: stats,
      total: Object.values(stats).reduce((a, b) => a + b, 0)
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/cert/questions
 * 證照題目查詢
 * 
 * Query params:
 * - cert: google / aws / azure / ipas
 * - limit: 數量 (default: 20)
 */
router.get('/questions', async (req, res) => {
  try {
    const { cert, limit = 20 } = req.query;
    const maxLimit = Math.min(parseInt(limit), 100);
    
    let questions = [];
    
    if (cert === 'ipas') {
      // iPAS 題庫
      const rows = await dbAll(`
        SELECT id, question, options, answer, explanation, category, difficulty
        FROM ipas_ise_questions
        ORDER BY RANDOM()
        LIMIT ?
      `, [maxLimit]);
      
      questions = rows.map(r => ({
        id: r.id,
        question: r.question,
        options: parseJSON(r.options),
        answer: r.answer,
        explanation: r.explanation,
        category: r.category,
        difficulty: r.difficulty
      }));
    } else {
      // AI 證照題庫
      const certId = cert?.toUpperCase() || 'GOOGLE';
      const rows = await dbAll(`
        SELECT id, question, options, answer, explanation, category, difficulty
        FROM ai_cert_questions
        WHERE cert_id = ?
        ORDER BY RANDOM()
        LIMIT ?
      `, [certId, maxLimit]);
      
      questions = rows.map(r => ({
        id: r.id,
        question: r.question,
        options: parseJSON(r.options),
        answer: r.answer,
        explanation: r.explanation,
        category: r.category,
        difficulty: r.difficulty
      }));
    }
    
    res.json({
      success: true,
      cert: cert,
      count: questions.length,
      data: questions
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 輔助函數
function parseJSON(str) {
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}
