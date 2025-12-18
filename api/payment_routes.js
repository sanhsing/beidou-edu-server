/**
 * 北斗教育 - 金流 API 路由
 */

const express = require('express');
const router = express.Router();
const ECPayService = require('../services/ecpay');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const ecpay = new ECPayService();

// 使用 runtime.db (統一用戶中心)
const RUNTIME_DB_PATH = process.env.RUNTIME_DB_PATH || path.join(__dirname, '../runtime.db');
const db = new sqlite3.Database(RUNTIME_DB_PATH, (err) => {
  if (err) {
    console.error('❌ payment_routes: runtime.db 連線失敗:', err.message);
  } else {
    console.log('✅ payment_routes: runtime.db 連線成功');
    // 確保金流相關表存在
    db.run(`
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
    `);
    db.run(`
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
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS user_certs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        cert_id TEXT NOT NULL,
        purchased_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, cert_id)
      )
    `);
  }
});

// 統一入口 - 建立付款 (Landing v8.0 調用)
router.post('/create', async (req, res) => {
  try {
    const { userId, plan, billingCycle, promoCode } = req.body;
    
    if (!userId || !plan) {
      return res.status(400).json({ error: 'Missing userId or plan' });
    }

    const payment = ecpay.createSubscriptionPayment({
      userId, plan, billingCycle, promoCode
    });

    // 記錄待付款訂單
    db.run(`
      INSERT INTO pending_orders (trade_no, user_id, order_type, plan, amount, status, created_at)
      VALUES (?, ?, 'subscription', ?, ?, 'pending', datetime('now'))
    `, [payment.tradeNo, userId, plan, payment.amount]);

    // 回傳 ECPay 表單 HTML（移除 paymentUrl，強制前端使用 form POST）
    res.json({
      success: true,
      html: payment.html,
      // paymentUrl 已移除 - ECPay 必須用 POST form，不能 GET 跳轉
      tradeNo: payment.tradeNo,
      amount: payment.amount,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 建立訂閱付款 (舊路徑保留)
router.post('/subscribe', async (req, res) => {
  try {
    const { userId, plan, billingCycle, promoCode } = req.body;
    
    if (!userId || !plan) {
      return res.status(400).json({ error: 'Missing userId or plan' });
    }

    const payment = ecpay.createSubscriptionPayment({
      userId, plan, billingCycle, promoCode
    });

    // 記錄待付款訂單
    db.run(`
      INSERT INTO pending_orders (trade_no, user_id, order_type, plan, amount, status, created_at)
      VALUES (?, ?, 'subscription', ?, ?, 'pending', datetime('now'))
    `, [payment.tradeNo, userId, plan, payment.amount]);

    res.json({
      success: true,
      html: payment.html,
      // paymentUrl 已移除 - ECPay 必須用 POST form
      params: payment.params,
      tradeNo: payment.tradeNo,
      amount: payment.amount,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 購買證照
router.post('/cert', async (req, res) => {
  try {
    const { userId, certId, isPro } = req.body;
    
    const payment = ecpay.createCertPayment({ userId, certId, isPro });

    db.run(`
      INSERT INTO pending_orders (trade_no, user_id, order_type, cert_id, amount, status, created_at)
      VALUES (?, ?, 'cert', ?, ?, 'pending', datetime('now'))
    `, [payment.tradeNo, userId, certId, payment.amount]);

    res.json({
      success: true,
      html: payment.html,
      // paymentUrl 已移除 - ECPay 必須用 POST form
      params: payment.params,
      tradeNo: payment.tradeNo,
      amount: payment.amount,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 綠界回呼
router.post('/callback', async (req, res) => {
  try {
    const params = req.body;
    
    // 驗證簽章
    if (!ecpay.verifyCallback(params)) {
      return res.send('0|CheckMacValue Error');
    }

    const { MerchantTradeNo, RtnCode, CustomField1, CustomField2, CustomField3 } = params;
    const userId = CustomField1;
    const orderType = CustomField2;

    if (RtnCode === '1') {
      // 付款成功
      db.run(`UPDATE pending_orders SET status = 'paid' WHERE trade_no = ?`, [MerchantTradeNo]);

      if (orderType === 'standard' || orderType === 'pro') {
        // 訂閱成功
        const billingCycle = CustomField3;
        const expireDate = billingCycle === 'yearly' 
          ? "datetime('now', '+1 year')"
          : "datetime('now', '+1 month')";

        db.run(`
          INSERT OR REPLACE INTO user_subscriptions (user_id, plan, status, billing_cycle, expires_at, updated_at)
          VALUES (?, ?, 'active', ?, ${expireDate}, datetime('now'))
        `, [userId, orderType, billingCycle]);

      } else if (orderType === 'cert') {
        // 證照購買成功
        const certId = CustomField3;
        db.run(`
          INSERT INTO user_certs (user_id, cert_id, purchased_at)
          VALUES (?, ?, datetime('now'))
        `, [userId, certId]);
      }
    }

    res.send('1|OK');
  } catch (err) {
    res.send('0|Error');
  }
});

// 查詢訂單狀態
router.get('/order/:tradeNo', (req, res) => {
  db.get('SELECT * FROM pending_orders WHERE trade_no = ?', [req.params.tradeNo], (err, row) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(row || { error: 'Order not found' });
  });
});

// 金流環境資訊 (測試用)
router.get('/env', (req, res) => {
  res.json({
    success: true,
    data: ecpay.getEnvInfo()
  });
});

// 測試付款頁面 (沙箱)
router.get('/test', (req, res) => {
  const testPayment = ecpay.createSubscriptionPayment({
    userId: 'test_user',
    plan: 'standard',
    billingCycle: 'monthly'
  });
  
  res.json({
    success: true,
    message: '測試付款資訊 (沙箱環境)',
    data: testPayment
  });
});

module.exports = router;
