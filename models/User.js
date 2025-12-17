/**
 * 用戶模型 - MongoDB
 * 北斗教育
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  // 基本資料
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  username: {
    type: String,
    required: true,
    trim: true
  },
  avatar: {
    type: String,
    default: ''
  },
  
  // 教育相關
  grade: {
    type: String,
    enum: ['高一', '高二', '高三', '其他'],
    default: '其他'
  },
  school: {
    type: String,
    default: ''
  },
  
  // 遊戲化
  level: {
    type: Number,
    default: 1
  },
  xp: {
    type: Number,
    default: 0
  },
  coins: {
    type: Number,
    default: 100
  },
  
  // 訂閱
  subscription: {
    plan: {
      type: String,
      enum: ['free', 'standard', 'premium'],
      default: 'free'
    },
    startDate: Date,
    endDate: Date,
    autoRenew: {
      type: Boolean,
      default: false
    }
  },
  
  // 推薦系統
  referralCode: {
    type: String,
    unique: true,
    sparse: true
  },
  referredBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  referralCount: {
    type: Number,
    default: 0
  },
  
  // 系統
  role: {
    type: String,
    enum: ['student', 'teacher', 'parent', 'admin'],
    default: 'student'
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'banned'],
    default: 'active'
  },
  lastLogin: Date,
  
}, { timestamps: true });

// 密碼加密
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

// 驗證密碼
userSchema.methods.comparePassword = async function(candidatePassword) {
  return bcrypt.compare(candidatePassword, this.password);
};

// 生成推薦碼
userSchema.pre('save', function(next) {
  if (!this.referralCode) {
    this.referralCode = 'BD' + Math.random().toString(36).substring(2, 8).toUpperCase();
  }
  next();
});

module.exports = mongoose.model('User', userSchema);
