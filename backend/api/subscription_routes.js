/**
 * 北斗教育訂閱系統 API
 * Express Router for Subscription Management
 */

const express = require('express');
const router = express.Router();
const Database = require('better-sqlite3');

// 資料庫連線
const db = new Database('./business.db');

// ============================================================
// 中間件：功能閘門
// ============================================================

const featureGate = (feature) => {
    return (req, res, next) => {
        const userId = req.user?.id || req.body?.userId;
        if (!userId) {
            return res.status(401).json({ success: false, error: 'unauthorized' });
        }
        
        const plan = getUserPlan(userId);
        const value = getFeatureValue(plan, feature);
        
        if (value === 'locked' || value === 'false') {
            return res.status(403).json({
                success: false,
                error: 'feature_locked',
                feature: feature,
                upgrade_prompt: {
                    message: `此功能需要升級才能使用`,
                    current_plan: plan,
                    required_plans: ['standard', 'pro']
                }
            });
        }
        
        req.featureLevel = value;
        next();
    };
};

const questionQuota = () => {
    return (req, res, next) => {
        const userId = req.user?.id || req.body?.userId;
        if (!userId) {
            return res.status(401).json({ success: false, error: 'unauthorized' });
        }
        
        const remaining = getRemainingQuestions(userId);
        
        if (remaining <= 0) {
            return res.status(403).json({
                success: false,
                error: 'quota_exceeded',
                remaining: 0,
                upgrade_prompt: {
                    message: '今日免費題數已用完',
                    cta: '升級標準版，無限練習',
                    plan: 'standard',
                    price: 99
                }
            });
        }
        
        req.remainingQuestions = remaining;
        next();
    };
};

// ============================================================
// 輔助函數
// ============================================================

function getUserPlan(userId) {
    const row = db.prepare(`
        SELECT plan, expires_at FROM user_subscriptions WHERE user_id = ?
    `).get(userId);
    
    if (!row) return 'free';
    
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
        return 'free';
    }
    
    return row.plan;
}

function getFeatureValue(plan, feature) {
    const row = db.prepare(`
        SELECT value FROM plan_features WHERE plan = ? AND feature = ?
    `).get(plan, feature);
    
    return row ? row.value : 'locked';
}

function getRemainingQuestions(userId) {
    const plan = getUserPlan(userId);
    const limitValue = getFeatureValue(plan, 'daily_questions');
    
    if (limitValue === 'unlimited') return Infinity;
    
    const limit = parseInt(limitValue);
    const today = new Date().toISOString().split('T')[0];
    
    const usage = db.prepare(`
        SELECT questions_done FROM daily_usage 
        WHERE user_id = ? AND usage_date = ?
    `).get(userId, today);
    
    const done = usage ? usage.questions_done : 0;
    return Math.max(0, limit - done);
}

function recordUsage(userId, type, count = 1) {
    const today = new Date().toISOString().split('T')[0];
    const column = type === 'questions' ? 'questions_done' :
                   type === 'battles' ? 'battles_played' : 'reviews_done';
    
    db.prepare(`
        INSERT INTO daily_usage (user_id, usage_date, ${column})
        VALUES (?, ?, ?)
        ON CONFLICT(user_id, usage_date) DO UPDATE SET
            ${column} = ${column} + ?
    `).run(userId, today, count, count);
}

// ============================================================
// API 路由
// ============================================================

// 取得用戶訂閱資訊
router.get('/subscription/:userId', (req, res) => {
    const { userId } = req.params;
    
    const row = db.prepare(`
        SELECT * FROM user_subscriptions WHERE user_id = ?
    `).get(userId);
    
    if (!row) {
        return res.json({
            success: true,
            data: {
                user_id: userId,
                plan: 'free',
                billing_cycle: null,
                expires_at: null
            }
        });
    }
    
    res.json({ success: true, data: row });
});

// 取得用戶所有功能權限
router.get('/features/:userId', (req, res) => {
    const { userId } = req.params;
    const plan = getUserPlan(userId);
    
    const rows = db.prepare(`
        SELECT feature, value, description FROM plan_features WHERE plan = ?
    `).all(plan);
    
    const features = {};
    rows.forEach(row => {
        let value = row.value;
        if (value === 'true') value = true;
        else if (value === 'false') value = false;
        else if (value === 'locked') value = null;
        else if (value === 'unlimited') value = Infinity;
        else if (!isNaN(value)) value = parseInt(value);
        
        features[row.feature] = value;
    });
    
    res.json({
        success: true,
        data: {
            plan,
            features
        }
    });
});

// 檢查單一功能
router.get('/check-feature/:userId/:feature', (req, res) => {
    const { userId, feature } = req.params;
    const plan = getUserPlan(userId);
    const value = getFeatureValue(plan, feature);
    
    const allowed = value !== 'locked' && value !== 'false';
    
    res.json({
        success: true,
        data: {
            feature,
            allowed,
            level: value,
            plan
        }
    });
});

// 取得剩餘題數
router.get('/quota/:userId', (req, res) => {
    const { userId } = req.params;
    const remaining = getRemainingQuestions(userId);
    const plan = getUserPlan(userId);
    
    res.json({
        success: true,
        data: {
            remaining: remaining === Infinity ? 'unlimited' : remaining,
            plan,
            upgrade_available: plan === 'free'
        }
    });
});

// 記錄使用量
router.post('/usage', (req, res) => {
    const { userId, type, count = 1 } = req.body;
    
    if (!userId || !type) {
        return res.status(400).json({ success: false, error: 'missing_params' });
    }
    
    recordUsage(userId, type, count);
    
    res.json({
        success: true,
        remaining: type === 'questions' ? getRemainingQuestions(userId) : null
    });
});

// 取得定價資訊
router.get('/pricing', (req, res) => {
    const pricing = db.prepare(`
        SELECT plan, billing_cycle, price, currency FROM plan_pricing
    `).all();
    
    const certPricing = db.prepare(`
        SELECT * FROM cert_pricing
    `).all();
    
    res.json({
        success: true,
        data: {
            plans: pricing,
            certs: certPricing
        }
    });
});

// 驗證優惠碼
router.post('/validate-promo', (req, res) => {
    const { code, plan } = req.body;
    
    const row = db.prepare(`
        SELECT * FROM promo_codes WHERE code = ?
    `).get(code.toUpperCase());
    
    if (!row) {
        return res.json({ success: false, error: '優惠碼不存在' });
    }
    
    // 檢查過期
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
        return res.json({ success: false, error: '優惠碼已過期' });
    }
    
    // 檢查使用次數
    if (row.max_uses && row.used_count >= row.max_uses) {
        return res.json({ success: false, error: '優惠碼已達使用上限' });
    }
    
    // 檢查適用方案
    const validPlans = JSON.parse(row.valid_plans);
    if (!validPlans.includes(plan)) {
        return res.json({ success: false, error: `此優惠碼不適用於 ${plan} 方案` });
    }
    
    res.json({
        success: true,
        data: {
            discount_type: row.discount_type,
            discount_value: row.discount_value
        }
    });
});

// 訂閱（簡化版，實際需整合金流）
router.post('/subscribe', (req, res) => {
    const { userId, plan, billingCycle, promoCode } = req.body;
    
    // 取得原價
    const pricing = db.prepare(`
        SELECT price FROM plan_pricing WHERE plan = ? AND billing_cycle = ?
    `).get(plan, billingCycle);
    
    if (!pricing) {
        return res.status(400).json({ success: false, error: 'invalid_plan' });
    }
    
    let finalPrice = pricing.price;
    
    // 套用優惠碼
    if (promoCode) {
        const promo = db.prepare(`
            SELECT discount_type, discount_value FROM promo_codes WHERE code = ?
        `).get(promoCode.toUpperCase());
        
        if (promo) {
            if (promo.discount_type === 'percent') {
                finalPrice = Math.round(finalPrice * (100 - promo.discount_value) / 100);
            } else {
                finalPrice = Math.max(0, finalPrice - promo.discount_value);
            }
            
            // 更新使用次數
            db.prepare(`
                UPDATE promo_codes SET used_count = used_count + 1 WHERE code = ?
            `).run(promoCode.toUpperCase());
        }
    }
    
    // 計算到期日
    const days = billingCycle === 'monthly' ? 30 : 365;
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    
    // 建立訂閱
    db.prepare(`
        INSERT INTO user_subscriptions 
        (user_id, plan, billing_cycle, price_paid, started_at, expires_at)
        VALUES (?, ?, ?, ?, datetime('now'), ?)
        ON CONFLICT(user_id) DO UPDATE SET
            plan = excluded.plan,
            billing_cycle = excluded.billing_cycle,
            price_paid = excluded.price_paid,
            started_at = datetime('now'),
            expires_at = excluded.expires_at,
            updated_at = datetime('now')
    `).run(userId, plan, billingCycle, finalPrice, expiresAt);
    
    // 記錄歷史
    db.prepare(`
        INSERT INTO subscription_history (user_id, action, to_plan, amount)
        VALUES (?, 'subscribe', ?, ?)
    `).run(userId, plan, finalPrice);
    
    res.json({
        success: true,
        data: {
            plan,
            price_paid: finalPrice,
            expires_at: expiresAt
        }
    });
});

// 取消訂閱
router.post('/cancel', (req, res) => {
    const { userId } = req.body;
    
    db.prepare(`
        UPDATE user_subscriptions SET auto_renew = 0, updated_at = datetime('now')
        WHERE user_id = ?
    `).run(userId);
    
    db.prepare(`
        INSERT INTO subscription_history (user_id, action)
        VALUES (?, 'cancel')
    `).run(userId);
    
    res.json({ success: true });
});

// ============================================================
// 匯出
// ============================================================

module.exports = {
    router,
    featureGate,
    questionQuota,
    getUserPlan,
    getFeatureValue,
    getRemainingQuestions,
    recordUsage
};
