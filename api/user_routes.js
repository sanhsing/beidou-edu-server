/**
 * 用戶 API 路由 - MongoDB
 * 北斗教育
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { AnswerRecord, DailyStats } = require('../models/LearningRecord');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'beidou-edu-secret-key-2024';

// ============================================================
// 中間件：驗證 JWT
// ============================================================
const authMiddleware = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ success: false, error: '未提供認證 Token' });
    }
    
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId);
    
    if (!user) {
      return res.status(401).json({ success: false, error: '用戶不存在' });
    }
    
    req.user = user;
    next();
  } catch (error) {
    res.status(401).json({ success: false, error: '認證失敗' });
  }
};

// ============================================================
// 註冊
// ============================================================
router.post('/register', async (req, res) => {
  try {
    const { email, password, username, grade, referralCode } = req.body;
    
    // 檢查必填欄位
    if (!email || !password || !username) {
      return res.status(400).json({ 
        success: false, 
        error: '請填寫 email、密碼和用戶名' 
      });
    }
    
    // 檢查 email 是否已存在
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ 
        success: false, 
        error: 'Email 已被註冊' 
      });
    }
    
    // 處理推薦碼
    let referrer = null;
    if (referralCode) {
      referrer = await User.findOne({ referralCode });
      if (referrer) {
        referrer.referralCount += 1;
        referrer.coins += 50; // 推薦獎勵
        await referrer.save();
      }
    }
    
    // 建立用戶
    const user = new User({
      email,
      password,
      username,
      grade: grade || '其他',
      referredBy: referrer?._id,
      coins: referrer ? 150 : 100 // 被推薦者額外獎勵
    });
    
    await user.save();
    
    // 生成 JWT
    const token = jwt.sign(
      { userId: user._id },
      JWT_SECRET,
      { expiresIn: '30d' }
    );
    
    res.json({
      success: true,
      data: {
        token,
        user: {
          id: user._id,
          email: user.email,
          username: user.username,
          grade: user.grade,
          level: user.level,
          xp: user.xp,
          coins: user.coins,
          referralCode: user.referralCode,
          subscription: user.subscription
        }
      }
    });
    
  } catch (error) {
    console.error('註冊錯誤:', error);
    res.status(500).json({ success: false, error: '註冊失敗' });
  }
});

// ============================================================
// 登入
// ============================================================
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ 
        success: false, 
        error: '請填寫 email 和密碼' 
      });
    }
    
    // 查找用戶
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ 
        success: false, 
        error: 'Email 或密碼錯誤' 
      });
    }
    
    // 驗證密碼
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ 
        success: false, 
        error: 'Email 或密碼錯誤' 
      });
    }
    
    // 更新最後登入
    user.lastLogin = new Date();
    await user.save();
    
    // 生成 JWT
    const token = jwt.sign(
      { userId: user._id },
      JWT_SECRET,
      { expiresIn: '30d' }
    );
    
    res.json({
      success: true,
      data: {
        token,
        user: {
          id: user._id,
          email: user.email,
          username: user.username,
          grade: user.grade,
          level: user.level,
          xp: user.xp,
          coins: user.coins,
          referralCode: user.referralCode,
          subscription: user.subscription
        }
      }
    });
    
  } catch (error) {
    console.error('登入錯誤:', error);
    res.status(500).json({ success: false, error: '登入失敗' });
  }
});

// ============================================================
// 取得個人資料
// ============================================================
router.get('/profile', authMiddleware, async (req, res) => {
  try {
    const user = req.user;
    
    // 取得學習統計
    const today = new Date().toISOString().split('T')[0];
    const todayStats = await DailyStats.findOne({ 
      userId: user._id, 
      date: today 
    });
    
    // 取得總答題數
    const totalAnswers = await AnswerRecord.countDocuments({ userId: user._id });
    const correctAnswers = await AnswerRecord.countDocuments({ 
      userId: user._id, 
      isCorrect: true 
    });
    
    res.json({
      success: true,
      data: {
        user: {
          id: user._id,
          email: user.email,
          username: user.username,
          avatar: user.avatar,
          grade: user.grade,
          school: user.school,
          level: user.level,
          xp: user.xp,
          coins: user.coins,
          referralCode: user.referralCode,
          referralCount: user.referralCount,
          subscription: user.subscription,
          role: user.role,
          createdAt: user.createdAt
        },
        stats: {
          totalAnswers,
          correctAnswers,
          accuracy: totalAnswers > 0 ? Math.round((correctAnswers / totalAnswers) * 100) : 0,
          todayQuestions: todayStats?.totalQuestions || 0,
          streak: todayStats?.streak || 0
        }
      }
    });
    
  } catch (error) {
    console.error('取得資料錯誤:', error);
    res.status(500).json({ success: false, error: '取得資料失敗' });
  }
});

// ============================================================
// 記錄答題
// ============================================================
router.post('/record-answer', authMiddleware, async (req, res) => {
  try {
    const { questionId, subject, nodeId, userAnswer, correctAnswer, isCorrect, timeSpent, source } = req.body;
    
    // 儲存答題紀錄
    const record = new AnswerRecord({
      userId: req.user._id,
      questionId,
      subject,
      nodeId,
      userAnswer,
      correctAnswer,
      isCorrect,
      timeSpent,
      source: source || 'quiz'
    });
    await record.save();
    
    // 更新每日統計
    const today = new Date().toISOString().split('T')[0];
    let dailyStats = await DailyStats.findOne({ userId: req.user._id, date: today });
    
    if (!dailyStats) {
      // 檢查連續天數
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
      const yesterdayStats = await DailyStats.findOne({ userId: req.user._id, date: yesterday });
      
      dailyStats = new DailyStats({
        userId: req.user._id,
        date: today,
        streak: yesterdayStats ? yesterdayStats.streak + 1 : 1
      });
    }
    
    dailyStats.totalQuestions += 1;
    if (isCorrect) {
      dailyStats.correctCount += 1;
    } else {
      dailyStats.wrongCount += 1;
    }
    dailyStats.totalTime += timeSpent || 0;
    
    // 更新科目統計
    const subjectStats = dailyStats.subjectStats.get(subject) || { total: 0, correct: 0 };
    subjectStats.total += 1;
    if (isCorrect) subjectStats.correct += 1;
    dailyStats.subjectStats.set(subject, subjectStats);
    
    await dailyStats.save();
    
    // 更新用戶 XP
    const xpEarned = isCorrect ? 10 : 2;
    req.user.xp += xpEarned;
    
    // 升級檢查
    const newLevel = Math.floor(req.user.xp / 100) + 1;
    if (newLevel > req.user.level) {
      req.user.level = newLevel;
      req.user.coins += 50; // 升級獎勵
    }
    
    await req.user.save();
    
    res.json({
      success: true,
      data: {
        xpEarned,
        totalXp: req.user.xp,
        level: req.user.level,
        coins: req.user.coins,
        streak: dailyStats.streak
      }
    });
    
  } catch (error) {
    console.error('記錄答題錯誤:', error);
    res.status(500).json({ success: false, error: '記錄失敗' });
  }
});

// ============================================================
// 取得學習統計
// ============================================================
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const { days = 7 } = req.query;
    
    // 取得最近 N 天統計
    const startDate = new Date(Date.now() - days * 86400000).toISOString().split('T')[0];
    
    const dailyStats = await DailyStats.find({
      userId: req.user._id,
      date: { $gte: startDate }
    }).sort({ date: 1 });
    
    // 科目分布
    const subjectDistribution = await AnswerRecord.aggregate([
      { $match: { userId: req.user._id } },
      { $group: { 
        _id: '$subject', 
        total: { $sum: 1 },
        correct: { $sum: { $cond: ['$isCorrect', 1, 0] } }
      }}
    ]);
    
    res.json({
      success: true,
      data: {
        daily: dailyStats,
        subjects: subjectDistribution
      }
    });
    
  } catch (error) {
    console.error('取得統計錯誤:', error);
    res.status(500).json({ success: false, error: '取得統計失敗' });
  }
});

module.exports = router;

// ============================================================
// 排行榜
// ============================================================
router.get('/leaderboard', async (req, res) => {
  try {
    const { type = 'xp', limit = 50 } = req.query;
    
    let sortField = 'xp';
    if (type === 'streak') sortField = 'streak';
    else if (type === 'accuracy') sortField = 'accuracy';
    
    // 取得排行榜
    const rankings = await User.find({ status: 'active' })
      .select('username level xp')
      .sort({ [sortField]: -1 })
      .limit(parseInt(limit));
    
    // 補充統計資料
    const result = await Promise.all(rankings.map(async (user, idx) => {
      const totalAnswers = await AnswerRecord.countDocuments({ userId: user._id });
      const correctAnswers = await AnswerRecord.countDocuments({ userId: user._id, isCorrect: true });
      
      // 取得連續天數
      const today = new Date().toISOString().split('T')[0];
      const todayStats = await DailyStats.findOne({ userId: user._id, date: today });
      
      return {
        rank: idx + 1,
        username: user.username,
        level: user.level,
        xp: user.xp,
        streak: todayStats?.streak || 0,
        accuracy: totalAnswers > 0 ? Math.round((correctAnswers / totalAnswers) * 100) : 0
      };
    }));
    
    // 如果有登入，取得我的排名
    let myRank = null;
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const me = await User.findById(decoded.userId);
        if (me) {
          const myTotalAnswers = await AnswerRecord.countDocuments({ userId: me._id });
          const myCorrectAnswers = await AnswerRecord.countDocuments({ userId: me._id, isCorrect: true });
          const myTodayStats = await DailyStats.findOne({ userId: me._id, date: new Date().toISOString().split('T')[0] });
          
          // 計算排名
          const higherCount = await User.countDocuments({ [sortField]: { $gt: me[sortField] }, status: 'active' });
          
          myRank = {
            rank: higherCount + 1,
            username: me.username,
            level: me.level,
            xp: me.xp,
            streak: myTodayStats?.streak || 0,
            accuracy: myTotalAnswers > 0 ? Math.round((myCorrectAnswers / myTotalAnswers) * 100) : 0
          };
        }
      } catch (e) {}
    }
    
    res.json({
      success: true,
      data: {
        type,
        rankings: result,
        myRank
      }
    });
    
  } catch (error) {
    console.error('排行榜錯誤:', error);
    res.status(500).json({ success: false, error: '取得排行榜失敗' });
  }
});

// ============================================================
// 取得錯題列表
// ============================================================
router.get('/wrong-questions', authMiddleware, async (req, res) => {
  try {
    const { limit = 100, subject } = req.query;
    
    const query = { userId: req.user._id, isCorrect: false };
    if (subject) query.subject = subject;
    
    const wrongRecords = await AnswerRecord.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));
    
    // 去重 (同一題只保留最近一次)
    const seen = new Set();
    const uniqueWrong = [];
    
    for (const record of wrongRecords) {
      if (!seen.has(record.questionId)) {
        seen.add(record.questionId);
        uniqueWrong.push({
          id: record.questionId,
          subject: record.subject,
          nodeId: record.nodeId,
          userAnswer: record.userAnswer,
          correctAnswer: record.correctAnswer,
          wrongAt: record.createdAt,
          // 題目詳情需要另外查詢 SQLite，這裡先返回基本資訊
          text: `題目 ${record.questionId}`,
          options: [],
          explanation: ''
        });
      }
    }
    
    res.json({
      success: true,
      data: {
        total: uniqueWrong.length,
        questions: uniqueWrong
      }
    });
    
  } catch (error) {
    console.error('取得錯題錯誤:', error);
    res.status(500).json({ success: false, error: '取得錯題失敗' });
  }
});

// ============================================================
// 完整統計 API (支援 report.html)
// ============================================================
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const { days = 7 } = req.query;
    const userId = req.user._id;
    const startDate = new Date(Date.now() - days * 86400000);
    
    // 每日統計
    const dailyStats = await AnswerRecord.aggregate([
      { $match: { userId, createdAt: { $gte: startDate } } },
      { $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          totalQuestions: { $sum: 1 },
          correctCount: { $sum: { $cond: ['$isCorrect', 1, 0] } },
          totalTime: { $sum: '$timeSpent' }
      }},
      { $sort: { _id: 1 } }
    ]);
    
    // 科目統計
    const subjectStats = await AnswerRecord.aggregate([
      { $match: { userId, createdAt: { $gte: startDate } } },
      { $group: {
          _id: '$subject',
          total: { $sum: 1 },
          correct: { $sum: { $cond: ['$isCorrect', 1, 0] } }
      }},
      { $sort: { total: -1 } }
    ]);
    
    res.json({
      success: true,
      data: {
        daily: dailyStats.map(d => ({ date: d._id, ...d })),
        subjects: subjectStats
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: '取得統計失敗' });
  }
});

// ============================================================
// 題目詳情 API (錯題本用)
// ============================================================
router.get('/question-detail/:questionId', async (req, res) => {
  try {
    const { questionId } = req.params;
    // 這裡需要查詢 SQLite，暫時返回佔位資料
    // 實際部署時應該從 education.db 查詢
    res.json({
      success: true,
      data: {
        id: questionId,
        text: '題目內容需從題庫載入',
        options: ['選項A', '選項B', '選項C', '選項D'],
        answer: 0,
        explanation: '解析需從題庫載入'
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: '取得題目失敗' });
  }
});
