/**
 * 北斗教育 API Server v7.8.1
 * 混合式架構：SQLite (題庫) + MongoDB (用戶)
 * 
 * 北斗七星文創數位有限公司 © 2025
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// MongoDB 連線
const { connectMongoDB, getConnectionStatus } = require('./config/mongodb');

const app = express();
const PORT = process.env.PORT || 10000;

// Trust proxy (Render 使用反向代理)
app.set('trust proxy', 1);

// ============================================================
// 中間件
// ============================================================

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'https://sanhsing.github.io',
    'https://beidou.edu.tw',
    'https://beidou-landing.onrender.com',
    'https://beidou-edu.onrender.com',
    'https://beidou-edu-server-1.onrender.com'
  ],
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('frontend'));

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: '請求過於頻繁，請稍後再試' }
});
app.use('/api/', limiter);

// ============================================================
// 資料庫連線
// ============================================================

// SQLite (題庫 - 唯讀)
const DB_PATH = process.env.DB_PATH || './education.db';
let db = null;

// SQLite (金流 - 可寫)
const PAYMENT_DB_PATH = process.env.PAYMENT_DB_PATH || './payment.db';
let paymentDb = null;

// SQLite (用戶資料 - 可寫)
const RUNTIME_DB_PATH = process.env.RUNTIME_DB_PATH || './runtime.db';
let runtimeDb = null;

function getDb() {
  if (!db) {
    db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READONLY, (err) => {
      if (err) {
        console.error('❌ 題庫連線失敗:', err.message);
      } else {
        console.log('✅ 題庫連線成功:', DB_PATH);
      }
    });
  }
  return db;
}

function getPaymentDb() {
  if (!paymentDb) {
    paymentDb = new sqlite3.Database(PAYMENT_DB_PATH, (err) => {
      if (err) {
        console.error('❌ 金流DB連線失敗:', err.message);
      } else {
        console.log('✅ 金流DB連線成功:', PAYMENT_DB_PATH);
        // 連線成功後立即建表
        initPaymentTables(paymentDb);
      }
    });
  }
  return paymentDb;
}

function getRuntimeDb() {
  if (!runtimeDb) {
    runtimeDb = new sqlite3.Database(RUNTIME_DB_PATH, (err) => {
      if (err) {
        console.error('❌ 用戶DB連線失敗:', err.message);
      } else {
        console.log('✅ 用戶DB連線成功:', RUNTIME_DB_PATH);
      }
    });
  }
  return runtimeDb;
}

// 初始化金流相關資料表
function initPaymentTables(database) {
  // 待付款訂單
  database.run(`
    CREATE TABLE IF NOT EXISTS pending_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trade_no TEXT UNIQUE NOT NULL,
      user_id TEXT NOT NULL,
      order_type TEXT NOT NULL,
      plan TEXT,
      cert_id TEXT,
      amount INTEGER NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      paid_at TEXT
    )
  `, (err) => {
    if (err) console.error('❌ pending_orders:', err.message);
    else console.log('✅ pending_orders 就緒');
  });
  
  // 用戶訂閱
  database.run(`
    CREATE TABLE IF NOT EXISTS user_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT UNIQUE NOT NULL,
      plan TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      billing_cycle TEXT,
      expires_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT
    )
  `, (err) => {
    if (err) console.error('❌ user_subscriptions:', err.message);
    else console.log('✅ user_subscriptions 就緒');
  });
  
  // 用戶證照
  database.run(`
    CREATE TABLE IF NOT EXISTS user_certs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      cert_id TEXT NOT NULL,
      purchased_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(user_id, cert_id)
    )
  `, (err) => {
    if (err) console.error('❌ user_certs:', err.message);
    else console.log('✅ user_certs 就緒');
  });
}

// 啟動時初始化資料庫
getDb();
getPaymentDb();

// Promise 包裝
const dbAll = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    getDb().all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
};

const dbGet = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    getDb().get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

// Runtime DB helpers (用戶資料)
const runtimeAll = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    getRuntimeDb().all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
};

const runtimeGet = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    getRuntimeDb().get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

const runtimeRun = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    getRuntimeDb().run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
};

// ============================================================
// 核心 API 路由
// ============================================================

// 健康檢查
app.get('/health', (req, res) => {
  const mongoStatus = getConnectionStatus();
  const memUsage = process.memoryUsage();
  
  res.json({ 
    status: 'ok', 
    version: '7.7.1',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    environment: process.env.NODE_ENV || 'development',
    database: {
      sqlite: db ? 'connected' : 'disconnected', runtime: runtimeDb ? 'connected' : 'disconnected',
      mongodb: mongoStatus.connected ? 'connected' : 'disconnected'
    },
    memory: {
      used: Math.round(memUsage.heapUsed / 1024 / 1024),
      total: Math.round(memUsage.heapTotal / 1024 / 1024),
      unit: 'MB'
    }
  });
});

// API 根目錄
app.get('/api', (req, res) => {
  res.json({
    name: '北斗教育 API',
    version: '7.7.1',
    architecture: '混合式 (SQLite + MongoDB)',
    endpoints: [
      'GET  /health - 健康檢查',
      'GET  /api/stats - 統計數據',
      'GET  /api/subjects - 科目列表',
      '--- 題庫 ---',
      'GET  /api/quiz/questions - 統一題目查詢',
      'GET  /api/quiz/question/:id - 單題詳情',
      'GET  /api/quiz/gsat - 學測題庫',
      'GET  /api/quiz/xtf/:nodeId - XTF節點詳情',
      '--- 用戶 ---',
      'POST /api/user/register - 註冊',
      'POST /api/user/login - 登入',
      'GET  /api/user/profile - 個人資料',
      '--- 班級 ---',
      'POST /api/class/create - 建立班級',
      'POST /api/class/join - 加入班級',
      'GET  /api/class/:classId - 班級詳情',
      'GET  /api/class/:classId/leaderboard - 班級排行',
      '--- 課程 ---',
      'GET  /api/courses - 課程列表',
      'POST /api/courses/enroll - 報名課程',
      'GET  /api/courses/:courseId/progress/:userId - 學習進度',
      '--- 金流 ---',
      'POST /api/payment/subscribe - 訂閱付款',
      'POST /api/payment/cert - 證照購買',
      'GET  /api/payment/env - 環境資訊'
    ]
  });
});

// ============================================================
// 統計 API (關鍵 - Landing 頁面使用)
// ============================================================

app.get('/api/stats', async (req, res) => {
  try {
    // 知識節點數 (優先嘗試 xtf_nodes_v2)
    let nodesResult = await dbGet(`SELECT COUNT(*) as count FROM xtf_nodes_v2`);
    if (!nodesResult || nodesResult.count === 0) {
      nodesResult = await dbGet(`SELECT COUNT(*) as count FROM xtf_nodes`);
    }
    
    // 題目數 (優先嘗試 gsat_generated_questions)
    let questionsResult = await dbGet(`SELECT COUNT(*) as count FROM gsat_generated_questions`);
    if (!questionsResult || questionsResult.count === 0) {
      questionsResult = await dbGet(`SELECT COUNT(*) as count FROM quiz_bank`);
    }
    
    // 科目數
    let subjectsResult = await dbGet(`SELECT COUNT(DISTINCT subject_name) as count FROM xtf_nodes_v2`);
    if (!subjectsResult || subjectsResult.count === 0) {
      subjectsResult = await dbGet(`SELECT COUNT(DISTINCT subject) as count FROM xtf_nodes`);
    }
    
    // 各科統計
    let subjectStats = await dbAll(`
      SELECT 
        subject_name as subject,
        COUNT(*) as nodes
      FROM xtf_nodes_v2
      GROUP BY subject_name
      ORDER BY nodes DESC
    `);
    
    // 補充題目數
    for (let stat of subjectStats) {
      const qCount = await dbGet(`
        SELECT COUNT(*) as count FROM gsat_generated_questions 
        WHERE subject_category = ?
      `, [stat.subject]);
      stat.questions = qCount?.count || 0;
    }

    res.json({
      success: true,
      data: {
        total_nodes: nodesResult?.count || 771,
        total_questions: questionsResult?.count || 20217,
        total_subjects: subjectsResult?.count || 10,
        subjects: subjectStats,
        updated_at: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Stats error:', error);
    // v12.12 Fallback 數據
    res.json({ 
      success: true, 
      data: {
        total_nodes: 771,
        total_questions: 20217,
        total_subjects: 10,
        subjects: [
          { subject: '數學', nodes: 102, questions: 2688 },
          { subject: '物理', nodes: 78, questions: 2052 },
          { subject: '化學', nodes: 72, questions: 1896 },
          { subject: '生物', nodes: 68, questions: 1788 },
          { subject: '地球科學', nodes: 54, questions: 1422 },
          { subject: '國文', nodes: 118, questions: 3108 },
          { subject: '英文', nodes: 96, questions: 2529 },
          { subject: '歷史', nodes: 72, questions: 1896 },
          { subject: '地理', nodes: 58, questions: 1527 },
          { subject: '公民', nodes: 53, questions: 1311 }
        ],
        updated_at: new Date().toISOString()
      }
    });
  }
});

// ============================================================
// 科目 API
// ============================================================

app.get('/api/subjects', async (req, res) => {
  try {
    // 優先嘗試 quiz_bank（題庫表）
    let subjects = await dbAll(`
      SELECT 
        subject as id,
        subject as name,
        COUNT(*) as node_count
      FROM quiz_bank
      WHERE subject IS NOT NULL
      GROUP BY subject
      ORDER BY node_count DESC
    `);
    
    // 如果 quiz_bank 沒資料，嘗試 xtf_nodes_v2
    if (!subjects || subjects.length === 0) {
      subjects = await dbAll(`
        SELECT 
          subject_name as id,
          subject_name as name,
          COUNT(*) as node_count
        FROM xtf_nodes_v2
        GROUP BY subject_name
        ORDER BY node_count DESC
      `);
    }
    
    res.json({ success: true, data: subjects });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// 題庫 API - 已移至 quiz_routes.js
// ============================================================

// 題庫 API
// 隨機題目
app.get('/api/quiz/random', async (req, res) => {
  try {
    const count = Math.min(parseInt(req.query.count) || 10, 50);
    const subject = req.query.subject;
    
    let sql = `
      SELECT 
        id,
        node_id,
        subject_category as subject,
        question,
        options,
        answer,
        explanation,
        difficulty
      FROM gsat_generated_questions
    `;
    
    const params = [];
    if (subject) {
      sql += ` WHERE subject_category = ?`;
      params.push(subject);
    }
    
    sql += ` ORDER BY RANDOM() LIMIT ?`;
    params.push(count);
    
    const questions = await dbAll(sql, params);
    
    // 解析 options JSON
    const parsed = questions.map(q => {
      let opts = [];
      try {
        opts = typeof q.options === 'string' ? JSON.parse(q.options) : q.options;
      } catch(e) { opts = []; }
      return { ...q, options: opts };
    });
    
    res.json({ success: true, data: parsed, count: parsed.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 科目題目
app.get('/api/quiz/subject/:subject', async (req, res) => {
  try {
    const { subject } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;
    
    const questions = await dbAll(`
      SELECT 
        id,
        node_id,
        subject_category as subject,
        question,
        options,
        answer,
        explanation,
        difficulty
      FROM gsat_generated_questions
      WHERE subject_category = ?
      ORDER BY difficulty, RANDOM()
      LIMIT ? OFFSET ?
    `, [subject, limit, offset]);
    
    const parsed = questions.map(q => {
      let opts = [];
      try {
        opts = typeof q.options === 'string' ? JSON.parse(q.options) : q.options;
      } catch(e) { opts = []; }
      return { ...q, options: opts };
    });
    
    res.json({ success: true, data: parsed });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 節點題目
app.get('/api/quiz/node/:nodeId', async (req, res) => {
  try {
    const { nodeId } = req.params;
    
    const questions = await dbAll(`
      SELECT 
        id, node_id, subject_category as subject,
        question, options, answer, explanation, difficulty
      FROM gsat_generated_questions 
      WHERE node_id = ?
      ORDER BY difficulty
    `, [nodeId]);
    
    const parsed = questions.map(q => {
      let opts = [];
      try {
        opts = typeof q.options === 'string' ? JSON.parse(q.options) : q.options;
      } catch(e) { opts = []; }
      return { ...q, options: opts };
    });
    
    res.json({ success: true, data: parsed });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 答案檢查
app.post('/api/quiz/check', async (req, res) => {
  try {
    const { question_id, user_answer } = req.body;
    
    const question = await dbGet(`
      SELECT answer, explanation FROM gsat_generated_questions WHERE id = ?
    `, [question_id]);
    
    if (!question) {
      return res.status(404).json({ success: false, error: '題目不存在' });
    }
    
    const correct = question.answer === user_answer || 
                    question.answer === parseInt(user_answer);
    
    res.json({
      success: true,
      data: {
        correct,
        correct_answer: question.answer,
        explanation: question.explanation
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// 知識圖譜 API
// ============================================================

// 知識樹
app.get('/api/knowledge/tree/:subject', async (req, res) => {
  try {
    const { subject } = req.params;
    
    const nodes = await dbAll(`
      SELECT 
        node_id,
        topic,
        chapter,
        importance,
        difficulty,
        prerequisites
      FROM xtf_nodes
      WHERE subject = ?
      ORDER BY chapter, node_id
    `, [subject]);
    
    res.json({ success: true, data: nodes });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 節點詳情
app.get('/api/knowledge/node/:nodeId', async (req, res) => {
  try {
    const { nodeId } = req.params;
    
    const node = await dbGet(`
      SELECT * FROM xtf_nodes_v2 WHERE node_id = ?
    `, [nodeId]);
    
    if (!node) {
      return res.status(404).json({ success: false, error: '節點不存在' });
    }
    
    // 取得相關題目數
    const questionCount = await dbGet(`
      SELECT COUNT(*) as count FROM gsat_generated_questions WHERE node_id = ?
    `, [nodeId]);
    
    res.json({ 
      success: true, 
      data: {
        ...node,
        question_count: questionCount?.count || 0
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
// 題庫 API 結束

// 搜尋節點
app.get('/api/knowledge/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) {
      return res.status(400).json({ success: false, error: '請提供搜尋關鍵字' });
    }
    
    const nodes = await dbAll(`
      SELECT node_id, subject_name as subject, node_name as topic, chapter_name as chapter
      FROM xtf_nodes_v2
      WHERE node_name LIKE ? OR node_id LIKE ? OR term LIKE ?
      LIMIT 20
    `, [`%${q}%`, `%${q}%`, `%${q}%`]);
    
    res.json({ success: true, data: nodes });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// 證照考試 API
// ============================================================

app.get('/api/cert/exams', async (req, res) => {
  try {
    // 檢查是否有 cert_exams 表
    const tableExists = await dbGet(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='cert_exams'
    `);
    
    if (!tableExists) {
      // 返回預設證照列表
      return res.json({
        success: true,
        data: [
          { id: 'ipas_security', name: 'iPAS 資訊安全工程師', questions: 200 },
          { id: 'google_ai', name: 'Google AI Essentials', questions: 50 },
          { id: 'aws_cloud', name: 'AWS Cloud Practitioner', questions: 100 }
        ]
      });
    }
    
    const exams = await dbAll(`SELECT * FROM cert_exams ORDER BY name`);
    res.json({ success: true, data: exams });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/cert/:certId/questions', async (req, res) => {
  try {
    const { certId } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    
    let questions = [];
    
    // 根據 certId 選擇不同的表
    if (certId === 'ipas_security' || certId.startsWith('IPAS')) {
      // iPAS 資訊安全
      questions = await dbAll(`
        SELECT 
          question_id, domain_id, question_text, 
          options, answer, explanation, difficulty
        FROM ipas_ise_questions 
        ORDER BY RANDOM() LIMIT ?
      `, [limit]);
    } else {
      // AI 認證 (google_ai, aws_cloud 等)
      const certMap = {
        'google_ai': 'CERT001',
        'aws_cloud': 'CERT002', 
        'microsoft_ai': 'CERT003'
      };
      const mappedId = certMap[certId] || certId;
      
      questions = await dbAll(`
        SELECT 
          question_id, domain_id, question_text,
          options, answer, explanation, difficulty
        FROM ai_cert_questions 
        WHERE cert_id = ?
        ORDER BY RANDOM() LIMIT ?
      `, [mappedId, limit]);
    }
    
    // 格式化選項 (options 是 JSON 字串)
    const formatted = questions.map(q => {
      let opts = [];
      try {
        opts = typeof q.options === 'string' ? JSON.parse(q.options) : q.options;
      } catch(e) { opts = []; }
      return {
        id: q.question_id,
        category: q.domain_id,
        question: q.question_text,
        options: Array.isArray(opts) ? opts : [],
        answer: q.answer,
        explanation: q.explanation,
        difficulty: q.difficulty
      };
    });
    
    res.json({ success: true, data: formatted, count: formatted.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// XTF 知識節點 API (星圖/字卡使用)
// ============================================================

// XTF 節點列表 (星圖用)
app.get('/api/xtf-list', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 500, 2000);
    const subject = req.query.subject;
    
    let sql = `
      SELECT 
        node_id,
        subject,
        topic,
        chapter,
        importance,
        difficulty,
        prerequisites
      FROM xtf_nodes
    `;
    
    const params = [];
    if (subject) {
      sql += ` WHERE subject = ?`;
      params.push(subject);
    }
    
    sql += ` ORDER BY subject, chapter, node_id LIMIT ?`;
    params.push(limit);
    
    const nodes = await dbAll(sql, params);
    
    res.json({ success: true, data: nodes, count: nodes.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// XTF 節點詳情 (字卡用)
app.get('/api/xtf/node/:nodeId', async (req, res) => {
  try {
    const { nodeId } = req.params;
    
    const node = await dbGet(`
      SELECT * FROM xtf_nodes_v2 WHERE node_id = ?
    `, [nodeId]);
    
    if (!node) {
      return res.status(404).json({ success: false, error: '節點不存在' });
    }
    
    res.json({ success: true, data: node });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// XTF 隨機節點 (字卡用)
app.get('/api/xtf/random', async (req, res) => {
  try {
    const count = Math.min(parseInt(req.query.count) || 10, 50);
    const subject = req.query.subject;
    
    let sql = `
      SELECT 
        node_id,
        subject,
        topic,
        definition,
        explanation,
        memory_hook,
        application
      FROM xtf_nodes
    `;
    
    const params = [];
    if (subject) {
      sql += ` WHERE subject = ?`;
      params.push(subject);
    }
    
    sql += ` ORDER BY RANDOM() LIMIT ?`;
    params.push(count);
    
    const nodes = await dbAll(sql, params);
    
    res.json({ success: true, data: nodes });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// 掛載外部路由模組
// ============================================================

try {
  // 訂閱路由
  const subscriptionRouter = require('./api/subscription_routes').router;
  if (subscriptionRouter) {
    app.use('/api/subscription', subscriptionRouter);
    console.log('✅ 已載入: subscription_routes');
  }
} catch (e) {
  console.log('⚠️ subscription_routes 載入失敗:', e.message);
}

try {
  // 金流路由
  const paymentRouter = require('./api/payment_routes');
  if (paymentRouter) {
    app.use('/api/payment', paymentRouter);
    console.log('✅ 已載入: payment_routes');
  }
} catch (e) {
  console.log('⚠️ payment_routes 載入失敗:', e.message);
}

try {
  // 證照路由 (擴充)
  const certRouter = require('./api/cert_routes');
  if (certRouter) {
    app.use('/api/cert', certRouter);
    console.log('✅ 已載入: cert_routes');
  }
} catch (e) {
  console.log('⚠️ cert_routes 載入失敗:', e.message);
}

try {
  // 題庫路由 (擴充)
  const quizRouter = require('./api/quiz_routes');
  if (quizRouter) {
    app.use('/api/quiz', quizRouter);
    console.log('✅ 已載入: quiz_routes');
  }
} catch (e) {
  console.log('⚠️ quiz_routes 載入失敗:', e.message);
}

// ============================================================
// 錯誤處理
// ============================================================

app.use((err, req, res, next) => {
  console.error('Server Error:', err);
  res.status(500).json({ 
    success: false, 
    error: process.env.NODE_ENV === 'production' ? '伺服器錯誤' : err.message 
  });
});

// 404 handler 移到 startServer 內部，在所有路由掛載之後

// ============================================================
// 啟動伺服器
// ============================================================

async function startServer() {
  // 連線 MongoDB (用戶資料)
  const mongoose = await connectMongoDB();
  
  // 掛載用戶路由
  try {
    const userRouter = require('./api/user_routes');
    app.use('/api/user', userRouter);
    console.log('✅ 已載入: user_routes (MongoDB)');
  } catch (e) {
    console.log('⚠️ user_routes 載入失敗:', e.message);
  }
  
  // 掛載成就路由
  try {
    const achievementRouter = require('./api/achievement_routes');
    app.use('/api/achievements', achievementRouter);
    console.log('✅ 已載入: achievement_routes (MongoDB)');
  } catch (e) {
    console.log('⚠️ achievement_routes 載入失敗:', e.message);
  }
  
  // 掛載班級管理路由
  try {
    const classRouter = require('./api/class_routes');
    if (mongoose && classRouter.initModels) {
      classRouter.initModels(mongoose);
    }
    app.use('/api/class', classRouter);
    console.log('✅ 已載入: class_routes (班級管理)');
  } catch (e) {
    console.log('⚠️ class_routes 載入失敗:', e.message);
  }
  
  // 掛載課程路由
  try {
    const courseRouter = require('./api/course_routes');
    if (mongoose && courseRouter.initModels) {
      courseRouter.initModels(mongoose);
    }
    app.use('/api/courses', courseRouter);
    console.log('✅ 已載入: course_routes (AI認證課程)');
  } catch (e) {
    console.log('⚠️ course_routes 載入失敗:', e.message);
  }
  
  // 掛載金流路由
  try {
    const paymentRouter = require('./api/payment_routes');
    app.use('/api/payment', paymentRouter);
    console.log('✅ 已載入: payment_routes (ECPay金流)');
  } catch (e) {
    console.log('⚠️ payment_routes 載入失敗:', e.message);
  }
  
  // 掛載題庫路由
  try {
    const quizRouter = require('./api/quiz_routes');
    app.use('/api/quiz', quizRouter);
    console.log('✅ 已載入: quiz_routes (題庫API)');
  } catch (e) {
    console.log('⚠️ quiz_routes 載入失敗:', e.message);
  }
  
  // ============================================================
  // 內建 Progress API (使用 runtime.db)
  // ============================================================
  
  // 取得用戶進度
  app.get('/api/progress/:userId', async (req, res) => {
    try {
      const { userId } = req.params;
      const rtDb = getRuntimeDb();
      
      rtDb.all(`
        SELECT node_id, mastery, attempts, correct, last_attempt
        FROM user_progress 
        WHERE user_id = ?
        ORDER BY updated_at DESC
      `, [userId], (err, rows) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true, data: rows || [] });
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });
  
  // 進度摘要
  app.get('/api/progress/summary/:userId', async (req, res) => {
    try {
      const { userId } = req.params;
      const rtDb = getRuntimeDb();
      
      rtDb.get(`
        SELECT 
          COUNT(*) as total_nodes,
          SUM(attempts) as total_attempts,
          SUM(correct) as total_correct,
          AVG(mastery) as avg_mastery
        FROM user_progress 
        WHERE user_id = ?
      `, [userId], (err, row) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true, data: row || {} });
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });
  
  // ============================================================
  // 內建 Answers API (使用 runtime.db)
  // ============================================================
  
  // 提交答案
  app.post('/api/answers/submit', async (req, res) => {
    try {
      const { userId, questionId, answer, isCorrect, timeSpent } = req.body;
      const rtDb = getRuntimeDb();
      
      rtDb.run(`
        INSERT INTO user_answers (user_id, question_id, answer, is_correct, time_spent)
        VALUES (?, ?, ?, ?, ?)
      `, [userId || 'guest', questionId, answer, isCorrect ? 1 : 0, timeSpent || 0], function(err) {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true, data: { id: this.lastID } });
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });
  
  // 答題歷史
  app.get('/api/answers/history/:userId', async (req, res) => {
    try {
      const { userId } = req.params;
      const limit = Math.min(parseInt(req.query.limit) || 50, 200);
      const rtDb = getRuntimeDb();
      
      rtDb.all(`
        SELECT * FROM user_answers 
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `, [userId, limit], (err, rows) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true, data: rows || [] });
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });
  
  // 答題統計
  app.get('/api/answers/stats/:userId', async (req, res) => {
    try {
      const { userId } = req.params;
      const rtDb = getRuntimeDb();
      
      rtDb.get(`
        SELECT 
          COUNT(*) as total,
          SUM(is_correct) as correct,
          AVG(time_spent) as avg_time
        FROM user_answers 
        WHERE user_id = ?
      `, [userId], (err, row) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true, data: row || {} });
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });
  
  // ============================================================
  // 內建 Analytics API (使用 runtime.db)
  // ============================================================
  
  app.get('/api/analytics/dashboard/:userId', async (req, res) => {
    try {
      const { userId } = req.params;
      const rtDb = getRuntimeDb();
      
      // 並行查詢
      const getAnswerStats = new Promise((resolve, reject) => {
        rtDb.get(`
          SELECT COUNT(*) as total, SUM(is_correct) as correct
          FROM user_answers WHERE user_id = ?
        `, [userId], (err, row) => err ? reject(err) : resolve(row));
      });
      
      const getProgressStats = new Promise((resolve, reject) => {
        rtDb.get(`
          SELECT COUNT(*) as nodes_studied, AVG(mastery) as avg_mastery
          FROM user_progress WHERE user_id = ?
        `, [userId], (err, row) => err ? reject(err) : resolve(row));
      });
      
      const [answers, progress] = await Promise.all([getAnswerStats, getProgressStats]);
      
      res.json({
        success: true,
        data: {
          totalAnswers: answers?.total || 0,
          correctAnswers: answers?.correct || 0,
          accuracy: answers?.total ? Math.round((answers.correct / answers.total) * 100) : 0,
          nodesStudied: progress?.nodes_studied || 0,
          avgMastery: Math.round(progress?.avg_mastery || 0)
        }
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // 排行榜 API
  app.get('/api/analytics/leaderboard', async (req, res) => {
    try {
      const { type = 'mastery', limit = 20 } = req.query;
      const rtDb = getRuntimeDb();
      
      let sql;
      if (type === 'mastery') {
        sql = `
          SELECT 
            user_id,
            COUNT(*) as nodes_studied,
            AVG(mastery) as avg_mastery,
            SUM(correct) as total_correct
          FROM user_progress
          GROUP BY user_id
          ORDER BY avg_mastery DESC, total_correct DESC
          LIMIT ?
        `;
      } else {
        sql = `
          SELECT 
            user_id,
            COUNT(*) as total_answers,
            SUM(is_correct) as correct_answers,
            ROUND(100.0 * SUM(is_correct) / COUNT(*), 1) as accuracy
          FROM user_answers
          GROUP BY user_id
          ORDER BY correct_answers DESC, accuracy DESC
          LIMIT ?
        `;
      }
      
      rtDb.all(sql, [parseInt(limit)], (err, rows) => {
        if (err) return res.status(500).json({ success: false, error: err.message });
        
        // 加入排名
        const ranked = (rows || []).map((row, idx) => ({
          rank: idx + 1,
          ...row
        }));
        
        res.json({ success: true, data: ranked });
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // 404 handler（必須在所有路由之後）

  // 掛載學習進度路由 (P1新增)
  try {
    const progressRouter = require('./api/progress_routes');
    app.use('/api/progress', progressRouter);
    console.log('✅ 已載入: progress_routes (學習進度)');
  } catch (e) {
    console.log('⚠️ progress_routes 載入失敗:', e.message);
  }
  
  // 掛載答題記錄路由 (P1新增)
  try {
    const answersRouter = require('./api/answers_routes');
    app.use('/api/answers', answersRouter);
    console.log('✅ 已載入: answers_routes (答題記錄)');
  } catch (e) {
    console.log('⚠️ answers_routes 載入失敗:', e.message);
  }
  
  // 掛載統計分析路由 (P1新增)
  try {
    const analyticsRouter = require('./api/analytics_routes');
    app.use('/api/analytics', analyticsRouter);
    console.log('✅ 已載入: analytics_routes (統計分析)');
  } catch (e) {
    console.log('⚠️ analytics_routes 載入失敗:', e.message);
  }

  // ============================================================
  // 答題記錄 API (使用 runtime.db)
  // ============================================================
  
  app.post('/api/answers/submit', async (req, res) => {
    try {
      const { userId, questionId, answer, isCorrect, timeSpent } = req.body;
      
      if (!userId || !questionId) {
        return res.status(400).json({ success: false, error: '缺少必要參數' });
      }
      
      const result = await runtimeRun(`
        INSERT INTO user_answers (user_id, question_id, answer, is_correct, time_spent)
        VALUES (?, ?, ?, ?, ?)
      `, [userId, questionId, answer, isCorrect ? 1 : 0, timeSpent || 0]);
      
      res.json({ success: true, data: { id: result.lastID } });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/answers/history/:userId', async (req, res) => {
    try {
      const { userId } = req.params;
      const limit = parseInt(req.query.limit) || 50;
      
      const answers = await runtimeAll(`
        SELECT * FROM user_answers 
        WHERE user_id = ? 
        ORDER BY created_at DESC 
        LIMIT ?
      `, [userId, limit]);
      
      res.json({ success: true, data: answers });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============================================================
  // 學習進度 API (使用 runtime.db)
  // ============================================================

  app.get('/api/progress/:userId', async (req, res) => {
    try {
      const { userId } = req.params;
      
      const progress = await runtimeAll(`
        SELECT * FROM user_progress 
        WHERE user_id = ? 
        ORDER BY updated_at DESC
      `, [userId]);
      
      res.json({ success: true, data: progress });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.post('/api/progress/update', async (req, res) => {
    try {
      const { userId, nodeId, correct } = req.body;
      
      if (!userId || !nodeId) {
        return res.status(400).json({ success: false, error: '缺少必要參數' });
      }
      
      // UPSERT 邏輯
      const existing = await runtimeGet(`
        SELECT * FROM user_progress WHERE user_id = ? AND node_id = ?
      `, [userId, nodeId]);
      
      if (existing) {
        const newAttempts = existing.attempts + 1;
        const newCorrect = existing.correct + (correct ? 1 : 0);
        const newMastery = Math.round((newCorrect / newAttempts) * 100);
        
        await runtimeRun(`
          UPDATE user_progress 
          SET attempts = ?, correct = ?, mastery = ?, last_attempt = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
          WHERE user_id = ? AND node_id = ?
        `, [newAttempts, newCorrect, newMastery, userId, nodeId]);
      } else {
        await runtimeRun(`
          INSERT INTO user_progress (user_id, node_id, attempts, correct, mastery, last_attempt)
          VALUES (?, ?, 1, ?, ?, CURRENT_TIMESTAMP)
        `, [userId, nodeId, correct ? 1 : 0, correct ? 100 : 0]);
      }
      
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.get('/api/progress/summary/:userId', async (req, res) => {
    try {
      const { userId } = req.params;
      
      const summary = await runtimeGet(`
        SELECT 
          COUNT(*) as total_nodes,
          SUM(attempts) as total_attempts,
          SUM(correct) as total_correct,
          AVG(mastery) as avg_mastery
        FROM user_progress 
        WHERE user_id = ?
      `, [userId]);
      
      res.json({ success: true, data: summary || { total_nodes: 0, total_attempts: 0, total_correct: 0, avg_mastery: 0 } });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  // ============================================================
  // 統計儀表板 API (使用 runtime.db)
  // ============================================================

  app.get('/api/analytics/dashboard/:userId', async (req, res) => {
    try {
      const { userId } = req.params;
      
      // 進度摘要
      const progress = await runtimeGet(`
        SELECT 
          COUNT(*) as nodes_studied,
          SUM(attempts) as total_attempts,
          SUM(correct) as total_correct,
          AVG(mastery) as avg_mastery
        FROM user_progress WHERE user_id = ?
      `, [userId]);
      
      // 最近答題
      const recentAnswers = await runtimeAll(`
        SELECT * FROM user_answers 
        WHERE user_id = ? 
        ORDER BY created_at DESC LIMIT 10
      `, [userId]);
      
      res.json({ 
        success: true, 
        data: {
          progress: progress || {},
          recentAnswers,
          accuracy: progress && progress.total_attempts > 0 
            ? Math.round((progress.total_correct / progress.total_attempts) * 100) 
            : 0
        }
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  app.use((req, res) => {
    res.status(404).json({ success: false, error: '找不到此路徑' });
  });
  
  // 啟動
  app.listen(PORT, () => {
    console.log('================================================');
    console.log(`🚀 北斗教育 API Server v7.8.1`);
    console.log(`📍 Port: ${PORT}`);
    console.log(`📊 SQLite: ${DB_PATH}`);
    console.log(`📦 MongoDB: ${getConnectionStatus().connected ? '已連線' : '未連線'}`);
    console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log('================================================');
    
    // 初始化 SQLite 連線
    getDb();
  });
}

startServer();


// ============================================================
// XTF v2 API (新增)
// ============================================================

// XTF 節點列表 v2 (星圖用)
app.get('/api/xtf/list', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 500, 2000);
    const subject = req.query.subject;
    
    let sql = `
      SELECT 
        node_id,
        subject_name as subject,
        chapter_id,
        node_name as topic,
        importance,
        difficulty,
        prerequisites
      FROM xtf_nodes_v2
    `;
    
    const params = [];
    if (subject) {
      sql += ` WHERE subject_name = ?`;
      params.push(subject);
    }
    
    sql += ` ORDER BY subject_name, chapter_id, node_id LIMIT ?`;
    params.push(limit);
    
    const nodes = await dbAll(sql, params);
    
    res.json({ success: true, data: nodes, count: nodes.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// XTF 節點詳情 v2 (字卡用)
app.get('/api/xtf/v2/node/:nodeId', async (req, res) => {
  try {
    const { nodeId } = req.params;
    
    const node = await dbGet(`
      SELECT 
        node_id,
        subject_name as subject,
        chapter_id,
        node_name as topic,
        definition,
        plain,
        understand,
        memorize,
        apply,
        importance,
        difficulty,
        prerequisites,
        next_nodes
      FROM xtf_nodes_v2 WHERE node_id = ?
    `, [nodeId]);
    
    if (!node) {
      return res.status(404).json({ success: false, error: '節點不存在' });
    }
    
    const xtf = {
      node_id: node.node_id,
      subject: node.subject,
      topic: node.topic,
      x: { definition: node.definition, plain: node.plain },
      t: { understand: node.understand, prerequisites: node.prerequisites, next_nodes: node.next_nodes },
      f: { memorize: node.memorize, apply: node.apply },
      meta: { importance: node.importance, difficulty: node.difficulty }
    };
    
    res.json({ success: true, data: xtf });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// XTF 隨機節點 v2 (字卡用)
app.get('/api/xtf/v2/random', async (req, res) => {
  try {
    const count = Math.min(parseInt(req.query.count) || 10, 50);
    const subject = req.query.subject;
    
    let sql = `
      SELECT 
        node_id,
        subject_name as subject,
        node_name as topic,
        definition,
        plain,
        understand,
        memorize,
        apply
      FROM xtf_nodes_v2
    `;
    
    const params = [];
    if (subject) {
      sql += ` WHERE subject_name = ?`;
      params.push(subject);
    }
    
    sql += ` ORDER BY RANDOM() LIMIT ?`;
    params.push(count);
    
    const nodes = await dbAll(sql, params);
    
    res.json({ success: true, data: nodes });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 學測題目 API (前端 quiz_ui 使用)
app.get('/api/quiz/gsat/questions', async (req, res) => {
  try {
    const { subject, count = 10, shuffle = true } = req.query;
    const limit = Math.min(parseInt(count), 50);
    
    let sql = `
      SELECT 
        id,
        subject_category as subject,
        question,
        options,
        answer,
        explanation,
        difficulty
      FROM gsat_generated_questions
    `;
    
    const params = [];
    if (subject) {
      sql += ` WHERE subject_category = ?`;
      params.push(subject);
    }
    
    if (shuffle === 'true' || shuffle === true) {
      sql += ` ORDER BY RANDOM()`;
    }
    
    sql += ` LIMIT ?`;
    params.push(limit);
    
    const rows = await dbAll(sql, params);
    
    // options 是 JSON 字串，需要解析
    const questions = rows.map(q => {
      let opts = [];
      try {
        opts = typeof q.options === 'string' ? JSON.parse(q.options) : q.options;
      } catch(e) {
        opts = [q.options];
      }
      return {
        id: q.id,
        subject: q.subject,
        question: q.question,
        options: Array.isArray(opts) ? opts : [opts],
        answer: q.answer,
        explanation: q.explanation,
        difficulty: q.difficulty
      };
    });
    
    res.json({ success: true, data: questions, count: questions.length });
  } catch (error) {
    console.error('GSAT questions error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});


module.exports = app;

// ============================================================
// API v2 - 新題型支援 (2025-12-22)
// ============================================================

// v2 統一題庫查詢
app.get('/api/v2/questions', async (req, res) => {
  try {
    const { subject, level, count = 10 } = req.query;
    const limit = Math.min(parseInt(count), 50);
    
    let sql = `SELECT * FROM unified_question_bank WHERE 1=1`;
    const params = [];
    
    if (subject) {
      sql += ` AND subject = ?`;
      params.push(subject);
    }
    if (level) {
      sql += ` AND exam_level = ?`;
      params.push(level);
    }
    
    sql += ` ORDER BY RANDOM() LIMIT ?`;
    params.push(limit);
    
    const rows = await dbAll(sql, params);
    
    const questions = rows.map(row => ({
      id: row.id,
      type: 'single_choice',
      subject: row.subject,
      topic: row.topic,
      level: row.exam_level,
      stem: row.stem,
      options: JSON.parse(row.options || '[]'),
      answer: row.answer,
      explanation: row.explanation,
      difficulty: row.difficulty,
      quality: row.quality_score
    }));
    
    res.json({ success: true, data: questions, count: questions.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// v2 新題型查詢 (matching/ordering/fill_blank/multiple_select)
app.get('/api/v2/types/:type', async (req, res) => {
  try {
    const validTypes = ['matching', 'ordering', 'fill_blank', 'multiple_select'];
    const qType = req.params.type;
    
    if (!validTypes.includes(qType)) {
      return res.status(400).json({ 
        success: false, 
        error: `Invalid type. Use: ${validTypes.join(', ')}` 
      });
    }
    
    const { subject, count = 10 } = req.query;
    const limit = Math.min(parseInt(count), 50);
    
    let sql = `SELECT * FROM new_question_types WHERE question_type = ?`;
    const params = [qType];
    
    if (subject) {
      sql += ` AND subject = ?`;
      params.push(subject);
    }
    
    sql += ` ORDER BY RANDOM() LIMIT ?`;
    params.push(limit);
    
    const rows = await dbAll(sql, params);
    
    const questions = rows.map(row => {
      const base = {
        id: row.id,
        type: row.question_type,
        subject: row.subject,
        template: row.template_key,
        difficulty: row.difficulty
      };
      
      switch (row.question_type) {
        case 'matching':
          const items = JSON.parse(row.items_json);
          return { ...base, instruction: row.stem, leftItems: items.left, rightItems: items.right, answer: JSON.parse(row.answer_json) };
        case 'ordering':
          return { ...base, instruction: row.stem, items: JSON.parse(row.items_json), answer: JSON.parse(row.answer_json) };
        case 'fill_blank':
          return { ...base, stem: row.stem, hint: JSON.parse(row.items_json).hint || '', answer: JSON.parse(row.answer_json) };
        case 'multiple_select':
          return { ...base, stem: row.stem, options: JSON.parse(row.items_json), answer: JSON.parse(row.answer_json) };
        default:
          return base;
      }
    });
    
    res.json({ success: true, data: questions, count: questions.length });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// v2 混合題型試卷
app.get('/api/v2/mixed-exam/:subject', async (req, res) => {
  try {
    const subject = req.params.subject;
    const { single = 10, matching = 2, ordering = 2, fill_blank = 3, multiple_select = 3 } = req.query;
    
    const questions = [];
    
    // 單選題
    if (parseInt(single) > 0) {
      const rows = await dbAll(
        `SELECT * FROM unified_question_bank WHERE subject = ? ORDER BY RANDOM() LIMIT ?`,
        [subject, parseInt(single)]
      );
      questions.push(...rows.map(r => ({ ...r, type: 'single_choice', options: JSON.parse(r.options || '[]') })));
    }
    
    // 新題型
    const types = [
      { name: 'matching', count: parseInt(matching) },
      { name: 'ordering', count: parseInt(ordering) },
      { name: 'fill_blank', count: parseInt(fill_blank) },
      { name: 'multiple_select', count: parseInt(multiple_select) }
    ];
    
    for (const t of types) {
      if (t.count > 0) {
        const rows = await dbAll(
          `SELECT * FROM new_question_types WHERE question_type = ? AND subject = ? ORDER BY RANDOM() LIMIT ?`,
          [t.name, subject, t.count]
        );
        questions.push(...rows.map(r => ({ ...r, type: r.question_type })));
      }
    }
    
    res.json({ 
      success: true, 
      data: {
        subject,
        totalQuestions: questions.length,
        questions,
        generatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// v2 通用答案驗證
app.post('/api/v2/check', async (req, res) => {
  try {
    const { type, questionId, answer } = req.body;
    
    if (type === 'single_choice') {
      const row = await dbGet(`SELECT answer, explanation FROM unified_question_bank WHERE id = ?`, [questionId]);
      if (!row) return res.json({ success: false, error: 'Question not found' });
      return res.json({ success: true, data: { correct: row.answer === answer, correctAnswer: row.answer, explanation: row.explanation }});
    }
    
    // 新題型
    const row = await dbGet(`SELECT answer_json, question_type FROM new_question_types WHERE id = ?`, [questionId]);
    if (!row) return res.json({ success: false, error: 'Question not found' });
    
    const correctAnswer = JSON.parse(row.answer_json);
    let correct = false;
    let score = 0;
    
    switch (row.question_type) {
      case 'matching':
      case 'ordering':
        correct = JSON.stringify(answer) === JSON.stringify(correctAnswer);
        score = correct ? 100 : 0;
        break;
      case 'fill_blank':
        correct = String(answer).toLowerCase() === String(correctAnswer).toLowerCase();
        score = correct ? 100 : 0;
        break;
      case 'multiple_select':
        const userSet = new Set(answer);
        const correctSet = new Set(correctAnswer);
        const correctCount = [...userSet].filter(x => correctSet.has(x)).length;
        const wrongCount = [...userSet].filter(x => !correctSet.has(x)).length;
        if (wrongCount === 0 && correctCount === correctSet.size) { score = 100; correct = true; }
        else if (wrongCount <= 1) { score = 60; }
        else if (wrongCount <= 2) { score = 20; }
        break;
    }
    
    res.json({ success: true, data: { correct, score, correctAnswer, userAnswer: answer }});
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// v2 完整統計
app.get('/api/v2/stats', async (req, res) => {
  try {
    const unifiedStats = await dbAll(`
      SELECT subject, exam_level, COUNT(*) as total, ROUND(AVG(quality_score), 1) as avgQuality
      FROM unified_question_bank GROUP BY subject, exam_level ORDER BY subject, exam_level
    `);
    
    const newTypeStats = await dbAll(`
      SELECT question_type, subject, COUNT(*) as total
      FROM new_question_types GROUP BY question_type, subject ORDER BY question_type, subject
    `);
    
    const unifiedTotal = (await dbGet(`SELECT COUNT(*) as c FROM unified_question_bank`)).c;
    const newTypeTotal = (await dbGet(`SELECT COUNT(*) as c FROM new_question_types`)).c;
    
    res.json({ 
      success: true, 
      data: {
        unified: { total: unifiedTotal, bySubjectLevel: unifiedStats },
        newTypes: { total: newTypeTotal, byTypeSubject: newTypeStats },
        grandTotal: unifiedTotal + newTypeTotal
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

console.log('✅ API v2 路由已載入 (新題型支援)');
