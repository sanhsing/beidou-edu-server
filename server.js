/**
 * 北斗教育 API Server v7.2
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
    'https://beidou-edu.onrender.com'
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

// 啟動時初始化兩個資料庫
getDb();
getPaymentDb();
}

// 啟動時觸發連線
getDb();

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

// ============================================================
// 核心 API 路由
// ============================================================

// 健康檢查
app.get('/health', (req, res) => {
  const mongoStatus = getConnectionStatus();
  const memUsage = process.memoryUsage();
  
  res.json({ 
    status: 'ok', 
    version: '7.4.0',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    environment: process.env.NODE_ENV || 'development',
    database: {
      sqlite: db ? 'connected' : 'disconnected',
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
    version: '7.4.0',
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

/* 舊版 API 已移除，由 quiz_routes.js 處理
// 隨機題目
app.get('/api/quiz/random', async (req, res) => {
  try {
    const count = Math.min(parseInt(req.query.count) || 10, 50);
    const subject = req.query.subject;
    
    let sql = `
      SELECT 
        q.question_id,
        q.node_id,
        q.question_type,
        q.stem,
        q.options,
        q.answer,
        q.explanation,
        q.difficulty,
        n.subject,
        n.topic
      FROM questions q
      JOIN xtf_nodes n ON q.node_id = n.node_id
    `;
    
    const params = [];
    if (subject) {
      sql += ` WHERE n.subject = ?`;
      params.push(subject);
    }
    
    sql += ` ORDER BY RANDOM() LIMIT ?`;
    params.push(count);
    
    const questions = await dbAll(sql, params);
    
    // 解析 options JSON
    const parsed = questions.map(q => ({
      ...q,
      options: typeof q.options === 'string' ? JSON.parse(q.options) : q.options
    }));
    
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
        q.question_id,
        q.node_id,
        q.stem,
        q.options,
        q.answer,
        q.difficulty,
        n.topic
      FROM questions q
      JOIN xtf_nodes n ON q.node_id = n.node_id
      WHERE n.subject = ?
      ORDER BY q.difficulty, RANDOM()
      LIMIT ? OFFSET ?
    `, [subject, limit, offset]);
    
    const parsed = questions.map(q => ({
      ...q,
      options: typeof q.options === 'string' ? JSON.parse(q.options) : q.options
    }));
    
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
      SELECT * FROM questions WHERE node_id = ?
      ORDER BY difficulty
    `, [nodeId]);
    
    const parsed = questions.map(q => ({
      ...q,
      options: typeof q.options === 'string' ? JSON.parse(q.options) : q.options
    }));
    
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
      SELECT answer, explanation FROM questions WHERE question_id = ?
    `, [question_id]);
    
    if (!question) {
      return res.status(404).json({ success: false, error: '題目不存在' });
    }
    
    const correct = question.answer === user_answer;
    
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
      SELECT * FROM xtf_nodes WHERE node_id = ?
    `, [nodeId]);
    
    if (!node) {
      return res.status(404).json({ success: false, error: '節點不存在' });
    }
    
    // 取得相關題目數
    const questionCount = await dbGet(`
      SELECT COUNT(*) as count FROM questions WHERE node_id = ?
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
舊版 API 結束 */

// 搜尋節點
app.get('/api/knowledge/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) {
      return res.status(400).json({ success: false, error: '請提供搜尋關鍵字' });
    }
    
    const nodes = await dbAll(`
      SELECT node_id, subject, topic, chapter
      FROM xtf_nodes
      WHERE topic LIKE ? OR node_id LIKE ?
      LIMIT 20
    `, [`%${q}%`, `%${q}%`]);
    
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
    
    // 嘗試從 cert_questions 表取得
    const tableExists = await dbGet(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name='cert_questions'
    `);
    
    if (!tableExists) {
      return res.json({ success: true, data: [], message: '證照題庫建置中' });
    }
    
    const questions = await dbAll(`
      SELECT * FROM cert_questions 
      WHERE cert_id = ?
      ORDER BY RANDOM()
      LIMIT ?
    `, [certId, limit]);
    
    res.json({ success: true, data: questions });
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
      SELECT * FROM xtf_nodes WHERE node_id = ?
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
  
  // 404 handler（必須在所有路由之後）
  app.use((req, res) => {
    res.status(404).json({ success: false, error: '找不到此路徑' });
  });
  
  // 啟動
  app.listen(PORT, () => {
    console.log('================================================');
    console.log(`🚀 北斗教育 API Server v7.4`);
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

module.exports = app;
