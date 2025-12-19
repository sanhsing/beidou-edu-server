/**
 * 成就系統 API - MongoDB
 * 北斗教育
 */

const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { AnswerRecord, DailyStats, Achievement } = require('../models/LearningRecord');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'beidou-edu-secret-key-2024';

// ============================================================
// 成就定義
// ============================================================

const ACHIEVEMENTS = {
  // 答題類
  'first_answer': {
    id: 'first_answer',
    name: '初試啼聲',
    description: '完成第一道題目',
    icon: '🎯',
    condition: { type: 'total_answers', value: 1 },
    xp: 10,
    coins: 20
  },
  'answer_10': {
    id: 'answer_10',
    name: '十題達人',
    description: '累計答題 10 道',
    icon: '📝',
    condition: { type: 'total_answers', value: 10 },
    xp: 50,
    coins: 30
  },
  'answer_100': {
    id: 'answer_100',
    name: '百題戰士',
    description: '累計答題 100 道',
    icon: '⚔️',
    condition: { type: 'total_answers', value: 100 },
    xp: 200,
    coins: 100
  },
  'answer_1000': {
    id: 'answer_1000',
    name: '千題宗師',
    description: '累計答題 1000 道',
    icon: '🏆',
    condition: { type: 'total_answers', value: 1000 },
    xp: 1000,
    coins: 500
  },
  
  // 正確率類
  'perfect_10': {
    id: 'perfect_10',
    name: '完美十連',
    description: '連續答對 10 題',
    icon: '✨',
    condition: { type: 'streak_correct', value: 10 },
    xp: 100,
    coins: 50
  },
  'accuracy_90': {
    id: 'accuracy_90',
    name: '精準射手',
    description: '總正確率達到 90%（至少 50 題）',
    icon: '🎯',
    condition: { type: 'accuracy', value: 90, minAnswers: 50 },
    xp: 300,
    coins: 150
  },
  
  // 連續學習類
  'streak_3': {
    id: 'streak_3',
    name: '三日不輟',
    description: '連續學習 3 天',
    icon: '🔥',
    condition: { type: 'streak_days', value: 3 },
    xp: 50,
    coins: 30
  },
  'streak_7': {
    id: 'streak_7',
    name: '週週向上',
    description: '連續學習 7 天',
    icon: '🌟',
    condition: { type: 'streak_days', value: 7 },
    xp: 150,
    coins: 100
  },
  'streak_30': {
    id: 'streak_30',
    name: '月度堅持',
    description: '連續學習 30 天',
    icon: '💎',
    condition: { type: 'streak_days', value: 30 },
    xp: 500,
    coins: 300
  },
  
  // 科目類
  'all_subjects': {
    id: 'all_subjects',
    name: '全科達人',
    description: '在所有 10 個科目都答過題',
    icon: '🌈',
    condition: { type: 'subjects_covered', value: 10 },
    xp: 200,
    coins: 100
  },
  
  // 等級類
  'level_5': {
    id: 'level_5',
    name: '初露鋒芒',
    description: '達到等級 5',
    icon: '⭐',
    condition: { type: 'level', value: 5 },
    xp: 0,
    coins: 50
  },
  'level_10': {
    id: 'level_10',
    name: '漸入佳境',
    description: '達到等級 10',
    icon: '🌟',
    condition: { type: 'level', value: 10 },
    xp: 0,
    coins: 100
  },
  'level_20': {
    id: 'level_20',
    name: '爐火純青',
    description: '達到等級 20',
    icon: '💫',
    condition: { type: 'level', value: 20 },
    xp: 0,
    coins: 200
  },
  
  // 推薦類
  'first_referral': {
    id: 'first_referral',
    name: '好友同行',
    description: '成功推薦 1 位好友',
    icon: '🤝',
    condition: { type: 'referrals', value: 1 },
    xp: 100,
    coins: 100
  },
  'referral_5': {
    id: 'referral_5',
    name: '人氣王',
    description: '成功推薦 5 位好友',
    icon: '👑',
    condition: { type: 'referrals', value: 5 },
    xp: 500,
    coins: 500
  }
};

// ============================================================
// 認證中間件
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
// 取得所有成就定義
// ============================================================
router.get('/list', (req, res) => {
  const list = Object.values(ACHIEVEMENTS).map(a => ({
    id: a.id,
    name: a.name,
    description: a.description,
    icon: a.icon,
    xp: a.xp,
    coins: a.coins
  }));
  
  res.json({
    success: true,
    data: {
      total: list.length,
      achievements: list
    }
  });
});

// ============================================================
// 取得用戶成就
// ============================================================
router.get('/mine', authMiddleware, async (req, res) => {
  try {
    // 取得已解鎖成就
    const unlocked = await Achievement.find({ userId: req.user._id });
    const unlockedIds = unlocked.map(a => a.achievementId);
    
    // 組合完整列表
    const list = Object.values(ACHIEVEMENTS).map(a => ({
      ...a,
      unlocked: unlockedIds.includes(a.id),
      unlockedAt: unlocked.find(u => u.achievementId === a.id)?.unlockedAt
    }));
    
    res.json({
      success: true,
      data: {
        total: list.length,
        unlocked: unlockedIds.length,
        achievements: list
      }
    });
    
  } catch (error) {
    console.error('取得成就錯誤:', error);
    res.status(500).json({ success: false, error: '取得成就失敗' });
  }
});

// ============================================================
// 檢查並解鎖成就
// ============================================================
router.post('/check', authMiddleware, async (req, res) => {
  try {
    const user = req.user;
    const newUnlocks = [];
    
    // 取得用戶統計
    const totalAnswers = await AnswerRecord.countDocuments({ userId: user._id });
    const correctAnswers = await AnswerRecord.countDocuments({ userId: user._id, isCorrect: true });
    const accuracy = totalAnswers > 0 ? Math.round((correctAnswers / totalAnswers) * 100) : 0;
    
    // 取得連續天數
    const today = new Date().toISOString().split('T')[0];
    const todayStats = await DailyStats.findOne({ userId: user._id, date: today });
    const streak = todayStats?.streak || 0;
    
    // 取得科目分布
    const subjects = await AnswerRecord.distinct('subject', { userId: user._id });
    
    // 已解鎖成就
    const unlocked = await Achievement.find({ userId: user._id });
    const unlockedIds = unlocked.map(a => a.achievementId);
    
    // 檢查每個成就
    for (const [id, achievement] of Object.entries(ACHIEVEMENTS)) {
      if (unlockedIds.includes(id)) continue;
      
      let shouldUnlock = false;
      const cond = achievement.condition;
      
      switch (cond.type) {
        case 'total_answers':
          shouldUnlock = totalAnswers >= cond.value;
          break;
        case 'accuracy':
          shouldUnlock = accuracy >= cond.value && totalAnswers >= (cond.minAnswers || 0);
          break;
        case 'streak_days':
          shouldUnlock = streak >= cond.value;
          break;
        case 'subjects_covered':
          shouldUnlock = subjects.length >= cond.value;
          break;
        case 'level':
          shouldUnlock = user.level >= cond.value;
          break;
        case 'referrals':
          shouldUnlock = user.referralCount >= cond.value;
          break;
      }
      
      if (shouldUnlock) {
        // 建立成就記錄
        await Achievement.create({
          userId: user._id,
          achievementId: id,
          name: achievement.name,
          description: achievement.description
        });
        
        // 發放獎勵
        user.xp += achievement.xp;
        user.coins += achievement.coins;
        
        newUnlocks.push({
          ...achievement,
          unlockedAt: new Date()
        });
      }
    }
    
    // 儲存用戶
    if (newUnlocks.length > 0) {
      await user.save();
    }
    
    res.json({
      success: true,
      data: {
        newUnlocks,
        totalXp: user.xp,
        totalCoins: user.coins,
        level: user.level
      }
    });
    
  } catch (error) {
    console.error('檢查成就錯誤:', error);
    res.status(500).json({ success: false, error: '檢查成就失敗' });
  }
});

module.exports = router;
