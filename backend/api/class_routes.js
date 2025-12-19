/**
 * 北斗教育 - 班級管理 API
 * 
 * 功能：
 * - 教師建立/管理班級
 * - 學生加入班級（邀請碼）
 * - 作業派發/追蹤
 * - 班級排行榜
 * - 學習報告
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');

// ============================================================
// MongoDB Models
// ============================================================

let Class, ClassMember, Assignment;

function initModels(mongoose) {
  // 班級 Schema
  const classSchema = new mongoose.Schema({
    classId: { type: String, unique: true, required: true },
    name: { type: String, required: true },
    description: String,
    teacherId: { type: String, required: true },
    teacherName: String,
    inviteCode: { type: String, unique: true },
    subject: String,  // 主要科目
    grade: String,    // 年級
    settings: {
      allowJoin: { type: Boolean, default: true },
      showRanking: { type: Boolean, default: true },
      parentAccess: { type: Boolean, default: true }
    },
    stats: {
      memberCount: { type: Number, default: 0 },
      assignmentCount: { type: Number, default: 0 },
      avgScore: { type: Number, default: 0 }
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
  });

  // 班級成員 Schema
  const memberSchema = new mongoose.Schema({
    classId: { type: String, required: true },
    userId: { type: String, required: true },
    role: { type: String, enum: ['student', 'teacher', 'parent'], default: 'student' },
    studentId: String,  // 家長關聯的學生ID
    displayName: String,
    joinedAt: { type: Date, default: Date.now },
    stats: {
      completedAssignments: { type: Number, default: 0 },
      avgScore: { type: Number, default: 0 },
      totalXp: { type: Number, default: 0 },
      streak: { type: Number, default: 0 }
    }
  });
  memberSchema.index({ classId: 1, userId: 1 }, { unique: true });

  // 作業 Schema
  const assignmentSchema = new mongoose.Schema({
    assignmentId: { type: String, unique: true, required: true },
    classId: { type: String, required: true },
    teacherId: String,
    title: { type: String, required: true },
    description: String,
    type: { type: String, enum: ['quiz', 'review', 'challenge'], default: 'quiz' },
    config: {
      subject: String,
      nodeIds: [String],      // 指定知識節點
      questionCount: { type: Number, default: 10 },
      timeLimit: Number,      // 分鐘
      passingScore: { type: Number, default: 60 },
      allowRetry: { type: Boolean, default: true },
      maxRetries: { type: Number, default: 3 }
    },
    dueDate: Date,
    status: { type: String, enum: ['draft', 'active', 'closed'], default: 'draft' },
    stats: {
      totalStudents: { type: Number, default: 0 },
      completed: { type: Number, default: 0 },
      avgScore: { type: Number, default: 0 }
    },
    createdAt: { type: Date, default: Date.now }
  });

  // 作業提交 Schema
  const submissionSchema = new mongoose.Schema({
    assignmentId: { type: String, required: true },
    classId: String,
    userId: { type: String, required: true },
    attempt: { type: Number, default: 1 },
    score: Number,
    correctCount: Number,
    totalCount: Number,
    timeSpent: Number,  // 秒
    answers: [{
      questionId: String,
      userAnswer: String,
      correct: Boolean
    }],
    submittedAt: { type: Date, default: Date.now }
  });
  submissionSchema.index({ assignmentId: 1, userId: 1 });

  Class = mongoose.models.Class || mongoose.model('Class', classSchema);
  ClassMember = mongoose.models.ClassMember || mongoose.model('ClassMember', memberSchema);
  Assignment = mongoose.models.Assignment || mongoose.model('Assignment', assignmentSchema);
  
  // Submission 可能已在其他地方定義
  if (!mongoose.models.AssignmentSubmission) {
    mongoose.model('AssignmentSubmission', submissionSchema);
  }
}

// ============================================================
// 工具函數
// ============================================================

function generateId(prefix = 'CLS') {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

function generateInviteCode() {
  // 6位大寫字母+數字，易於輸入
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// ============================================================
// 班級 CRUD
// ============================================================

/**
 * POST /api/class/create
 * 建立班級（教師）
 */
router.post('/create', async (req, res) => {
  try {
    const { teacherId, teacherName, name, description, subject, grade } = req.body;
    
    if (!teacherId || !name) {
      return res.status(400).json({ success: false, error: '缺少必要欄位' });
    }
    
    const classData = new Class({
      classId: generateId('CLS'),
      name,
      description,
      teacherId,
      teacherName,
      subject,
      grade,
      inviteCode: generateInviteCode()
    });
    
    await classData.save();
    
    // 教師自動加入班級
    await ClassMember.create({
      classId: classData.classId,
      userId: teacherId,
      role: 'teacher',
      displayName: teacherName
    });
    
    res.json({
      success: true,
      data: {
        classId: classData.classId,
        inviteCode: classData.inviteCode,
        name: classData.name
      }
    });
  } catch (error) {
    console.error('Create class error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/class/:classId
 * 取得班級詳情
 */
router.get('/:classId', async (req, res) => {
  try {
    const { classId } = req.params;
    
    const classData = await Class.findOne({ classId });
    if (!classData) {
      return res.status(404).json({ success: false, error: '班級不存在' });
    }
    
    // 取得成員列表
    const members = await ClassMember.find({ classId })
      .sort({ 'stats.totalXp': -1 });
    
    res.json({
      success: true,
      data: {
        ...classData.toObject(),
        members
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/class/teacher/:teacherId
 * 取得教師的所有班級
 */
router.get('/teacher/:teacherId', async (req, res) => {
  try {
    const { teacherId } = req.params;
    
    const classes = await Class.find({ teacherId })
      .sort({ createdAt: -1 });
    
    res.json({
      success: true,
      data: classes
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/class/student/:userId
 * 取得學生加入的班級
 */
router.get('/student/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const memberships = await ClassMember.find({ userId, role: 'student' });
    const classIds = memberships.map(m => m.classId);
    
    const classes = await Class.find({ classId: { $in: classIds } });
    
    res.json({
      success: true,
      data: classes.map(c => ({
        ...c.toObject(),
        membership: memberships.find(m => m.classId === c.classId)
      }))
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// 加入/離開班級
// ============================================================

/**
 * POST /api/class/join
 * 學生加入班級
 */
router.post('/join', async (req, res) => {
  try {
    const { userId, displayName, inviteCode } = req.body;
    
    if (!userId || !inviteCode) {
      return res.status(400).json({ success: false, error: '缺少必要欄位' });
    }
    
    // 查找班級
    const classData = await Class.findOne({ inviteCode: inviteCode.toUpperCase() });
    if (!classData) {
      return res.status(404).json({ success: false, error: '邀請碼無效' });
    }
    
    if (!classData.settings.allowJoin) {
      return res.status(403).json({ success: false, error: '此班級已關閉加入' });
    }
    
    // 檢查是否已加入
    const existing = await ClassMember.findOne({ 
      classId: classData.classId, 
      userId 
    });
    
    if (existing) {
      return res.status(400).json({ success: false, error: '已經是班級成員' });
    }
    
    // 加入班級
    await ClassMember.create({
      classId: classData.classId,
      userId,
      role: 'student',
      displayName
    });
    
    // 更新成員數
    await Class.updateOne(
      { classId: classData.classId },
      { $inc: { 'stats.memberCount': 1 } }
    );
    
    res.json({
      success: true,
      data: {
        classId: classData.classId,
        className: classData.name,
        teacherName: classData.teacherName
      }
    });
  } catch (error) {
    console.error('Join class error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/class/leave
 * 離開班級
 */
router.post('/leave', async (req, res) => {
  try {
    const { userId, classId } = req.body;
    
    const result = await ClassMember.deleteOne({ classId, userId, role: 'student' });
    
    if (result.deletedCount > 0) {
      await Class.updateOne(
        { classId },
        { $inc: { 'stats.memberCount': -1 } }
      );
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// 作業管理
// ============================================================

/**
 * POST /api/class/assignment/create
 * 建立作業
 */
router.post('/assignment/create', async (req, res) => {
  try {
    const { classId, teacherId, title, description, type, config, dueDate } = req.body;
    
    if (!classId || !title) {
      return res.status(400).json({ success: false, error: '缺少必要欄位' });
    }
    
    // 取得班級成員數
    const memberCount = await ClassMember.countDocuments({ 
      classId, 
      role: 'student' 
    });
    
    const assignment = await Assignment.create({
      assignmentId: generateId('ASN'),
      classId,
      teacherId,
      title,
      description,
      type: type || 'quiz',
      config: config || {},
      dueDate: dueDate ? new Date(dueDate) : null,
      status: 'active',
      'stats.totalStudents': memberCount
    });
    
    // 更新班級作業數
    await Class.updateOne(
      { classId },
      { $inc: { 'stats.assignmentCount': 1 } }
    );
    
    res.json({
      success: true,
      data: assignment
    });
  } catch (error) {
    console.error('Create assignment error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/class/:classId/assignments
 * 取得班級作業列表
 */
router.get('/:classId/assignments', async (req, res) => {
  try {
    const { classId } = req.params;
    const { status } = req.query;
    
    const query = { classId };
    if (status) query.status = status;
    
    const assignments = await Assignment.find(query)
      .sort({ createdAt: -1 });
    
    res.json({
      success: true,
      data: assignments
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/class/assignment/:assignmentId
 * 取得作業詳情（含提交狀態）
 */
router.get('/assignment/:assignmentId', async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const { userId } = req.query;
    
    const assignment = await Assignment.findOne({ assignmentId });
    if (!assignment) {
      return res.status(404).json({ success: false, error: '作業不存在' });
    }
    
    let submission = null;
    if (userId) {
      const Submission = require('mongoose').model('AssignmentSubmission');
      submission = await Submission.findOne({ assignmentId, userId })
        .sort({ attempt: -1 });
    }
    
    res.json({
      success: true,
      data: {
        ...assignment.toObject(),
        submission
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// 班級排行榜
// ============================================================

/**
 * GET /api/class/:classId/leaderboard
 * 班級排行榜
 */
router.get('/:classId/leaderboard', async (req, res) => {
  try {
    const { classId } = req.params;
    const { type = 'xp' } = req.query;
    
    let sortField = 'stats.totalXp';
    if (type === 'score') sortField = 'stats.avgScore';
    if (type === 'streak') sortField = 'stats.streak';
    
    const members = await ClassMember.find({ classId, role: 'student' })
      .sort({ [sortField]: -1 })
      .limit(50);
    
    res.json({
      success: true,
      data: members.map((m, i) => ({
        rank: i + 1,
        userId: m.userId,
        displayName: m.displayName,
        xp: m.stats.totalXp,
        avgScore: m.stats.avgScore,
        streak: m.stats.streak,
        completed: m.stats.completedAssignments
      }))
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// 學習報告（給家長）
// ============================================================

/**
 * GET /api/class/report/:classId/:studentId
 * 學生學習報告
 */
router.get('/report/:classId/:studentId', async (req, res) => {
  try {
    const { classId, studentId } = req.params;
    
    // 取得成員資料
    const member = await ClassMember.findOne({ classId, userId: studentId });
    if (!member) {
      return res.status(404).json({ success: false, error: '學生不存在' });
    }
    
    // 取得作業提交記錄
    const Submission = require('mongoose').model('AssignmentSubmission');
    const submissions = await Submission.find({ classId, userId: studentId })
      .sort({ submittedAt: -1 })
      .limit(20);
    
    // 計算統計
    const totalSubmissions = submissions.length;
    const avgScore = totalSubmissions > 0
      ? Math.round(submissions.reduce((sum, s) => sum + (s.score || 0), 0) / totalSubmissions)
      : 0;
    
    // 取得班級排名
    const allMembers = await ClassMember.find({ classId, role: 'student' })
      .sort({ 'stats.totalXp': -1 });
    const rank = allMembers.findIndex(m => m.userId === studentId) + 1;
    
    res.json({
      success: true,
      data: {
        student: {
          userId: studentId,
          displayName: member.displayName,
          joinedAt: member.joinedAt
        },
        stats: {
          ...member.stats,
          avgScore,
          rank,
          totalMembers: allMembers.length
        },
        recentSubmissions: submissions.slice(0, 10),
        summary: {
          strengths: [],   // TODO: 分析強項
          weaknesses: [],  // TODO: 分析弱項
          suggestions: []  // TODO: 學習建議
        }
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// 初始化 & 導出
// ============================================================

router.initModels = initModels;

module.exports = router;
