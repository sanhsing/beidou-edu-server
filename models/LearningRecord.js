/**
 * 學習紀錄模型 - MongoDB
 * 北斗教育
 */

const mongoose = require('mongoose');

// 答題紀錄
const answerRecordSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  questionId: {
    type: String,
    required: true
  },
  subject: {
    type: String,
    required: true
  },
  nodeId: String,
  
  // 答題結果
  userAnswer: Number,
  correctAnswer: Number,
  isCorrect: Boolean,
  timeSpent: Number, // 秒
  
  // 來源
  source: {
    type: String,
    enum: ['quiz', 'exam', 'practice', 'battle'],
    default: 'quiz'
  }
  
}, { timestamps: true });

// 索引
answerRecordSchema.index({ userId: 1, subject: 1 });
answerRecordSchema.index({ userId: 1, createdAt: -1 });

const AnswerRecord = mongoose.model('AnswerRecord', answerRecordSchema);

// 學習統計 (每日彙總)
const dailyStatsSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  date: {
    type: String, // YYYY-MM-DD
    required: true
  },
  
  // 統計
  totalQuestions: { type: Number, default: 0 },
  correctCount: { type: Number, default: 0 },
  wrongCount: { type: Number, default: 0 },
  totalTime: { type: Number, default: 0 }, // 秒
  xpEarned: { type: Number, default: 0 },
  
  // 科目細分
  subjectStats: {
    type: Map,
    of: {
      total: Number,
      correct: Number
    },
    default: {}
  },
  
  // 連續學習
  streak: { type: Number, default: 0 }
  
}, { timestamps: true });

dailyStatsSchema.index({ userId: 1, date: -1 }, { unique: true });

const DailyStats = mongoose.model('DailyStats', dailyStatsSchema);

// 成就紀錄
const achievementSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  achievementId: {
    type: String,
    required: true
  },
  name: String,
  description: String,
  unlockedAt: {
    type: Date,
    default: Date.now
  }
});

achievementSchema.index({ userId: 1, achievementId: 1 }, { unique: true });

const Achievement = mongoose.model('Achievement', achievementSchema);

module.exports = { AnswerRecord, DailyStats, Achievement };
