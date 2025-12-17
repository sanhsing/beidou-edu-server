/**
 * 北斗教育 - 金流 API 路由
 */

const express = require('express');
const router = express.Router();
const ECPayService = require('../services/ecpay');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const ecpay = new ECPayService();
const db = new sqlite3.Database(path.join(__dirname, '../business.db'));

// 建立訂閱付款
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
      paymentUrl: payment.url,
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
      paymentUrl: payment.url,
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
