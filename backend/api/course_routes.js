/**
 * 北斗教育 - AI 認證課程 API
 * 
 * 課程：
 * - Google AI Essentials $199
 * - AWS AI Practitioner $299
 * - Azure AI Fundamentals $299
 * - iPAS 資安認證 $149
 */

const express = require('express');
const router = express.Router();

// ============================================================
// 課程定義
// ============================================================

const COURSES = {
  'google-ai': {
    id: 'google-ai',
    name: 'Google AI Essentials',
    provider: 'Google',
    price: 199,
    proPrice: 399,
    description: 'Google 官方 AI 基礎認證備考課程',
    duration: '8 小時',
    modules: [
      { id: 'ga-01', name: 'AI 基礎概念', lessons: 5, duration: '60分鐘' },
      { id: 'ga-02', name: 'Google AI 產品生態', lessons: 4, duration: '45分鐘' },
      { id: 'ga-03', name: '機器學習基礎', lessons: 6, duration: '90分鐘' },
      { id: 'ga-04', name: '生成式 AI 與 LLM', lessons: 5, duration: '75分鐘' },
      { id: 'ga-05', name: '負責任的 AI', lessons: 4, duration: '45分鐘' },
      { id: 'ga-06', name: '模擬測驗', lessons: 3, duration: '90分鐘' }
    ],
    questionCount: 150,
    passingScore: 70,
    badge: '🎖️ Google AI Certified',
    features: {
      standard: ['完整課程內容', '150 題練習題', '模擬測驗 x2', '學習進度追蹤'],
      pro: ['標準版全部功能', 'AI 助教答疑', '無限次模擬測驗', '認證考試代報名指導', '1年更新保證']
    }
  },
  
  'aws-ai': {
    id: 'aws-ai',
    name: 'AWS AI Practitioner',
    provider: 'Amazon',
    price: 299,
    proPrice: 599,
    description: 'AWS 認證 AI 從業者備考課程',
    duration: '12 小時',
    modules: [
      { id: 'aa-01', name: 'AWS AI/ML 服務概覽', lessons: 6, duration: '90分鐘' },
      { id: 'aa-02', name: 'Amazon SageMaker', lessons: 5, duration: '75分鐘' },
      { id: 'aa-03', name: 'Amazon Bedrock & GenAI', lessons: 5, duration: '75分鐘' },
      { id: 'aa-04', name: 'AI 解決方案架構', lessons: 4, duration: '60分鐘' },
      { id: 'aa-05', name: '安全與合規', lessons: 4, duration: '45分鐘' },
      { id: 'aa-06', name: '模擬測驗', lessons: 4, duration: '120分鐘' }
    ],
    questionCount: 200,
    passingScore: 70,
    badge: '🏅 AWS AI Practitioner',
    features: {
      standard: ['完整課程內容', '200 題練習題', '模擬測驗 x3', 'AWS 架構圖解'],
      pro: ['標準版全部功能', 'AI 助教答疑', '實戰 Lab 演練', '認證考試代報名', '1年更新保證']
    }
  },
  
  'azure-ai': {
    id: 'azure-ai',
    name: 'Azure AI Fundamentals',
    provider: 'Microsoft',
    price: 299,
    proPrice: 599,
    description: 'Microsoft Azure AI-900 備考課程',
    duration: '10 小時',
    modules: [
      { id: 'az-01', name: 'AI 工作負載與考量', lessons: 5, duration: '60分鐘' },
      { id: 'az-02', name: 'Azure ML 基礎', lessons: 5, duration: '75分鐘' },
      { id: 'az-03', name: '電腦視覺', lessons: 4, duration: '60分鐘' },
      { id: 'az-04', name: '自然語言處理', lessons: 4, duration: '60分鐘' },
      { id: 'az-05', name: '生成式 AI', lessons: 5, duration: '75分鐘' },
      { id: 'az-06', name: '模擬測驗', lessons: 3, duration: '90分鐘' }
    ],
    questionCount: 180,
    passingScore: 70,
    badge: '🥇 Azure AI Fundamentals',
    features: {
      standard: ['完整課程內容', '180 題練習題', '模擬測驗 x2', 'Azure Portal 導覽'],
      pro: ['標準版全部功能', 'AI 助教答疑', 'Azure 免費帳號指導', '認證考試代報名', '1年更新保證']
    }
  },
  
  'ipas-security': {
    id: 'ipas-security',
    name: 'iPAS 資訊安全工程師',
    provider: '經濟部',
    price: 149,
    proPrice: 299,
    description: '經濟部 iPAS 資安認證備考課程',
    duration: '6 小時',
    modules: [
      { id: 'ip-01', name: '資訊安全管理', lessons: 5, duration: '60分鐘' },
      { id: 'ip-02', name: '網路安全', lessons: 4, duration: '45分鐘' },
      { id: 'ip-03', name: '系統安全', lessons: 4, duration: '45分鐘' },
      { id: 'ip-04', name: '應用程式安全', lessons: 4, duration: '45分鐘' },
      { id: 'ip-05', name: '法規與標準', lessons: 3, duration: '30分鐘' },
      { id: 'ip-06', name: '模擬測驗', lessons: 3, duration: '90分鐘' }
    ],
    questionCount: 120,
    passingScore: 60,
    badge: '🛡️ iPAS 資安認證',
    features: {
      standard: ['完整課程內容', '120 題練習題', '模擬測驗 x2', '考古題解析'],
      pro: ['標準版全部功能', 'AI 助教答疑', '報名流程指導', '考場經驗分享', '1年更新保證']
    }
  }
};

// ============================================================
// MongoDB Models
// ============================================================

let CourseEnrollment, CourseProgress;

function initModels(mongoose) {
  // 課程報名 Schema
  const enrollmentSchema = new mongoose.Schema({
    enrollmentId: { type: String, unique: true, required: true },
    userId: { type: String, required: true },
    courseId: { type: String, required: true },
    tier: { type: String, enum: ['standard', 'pro'], default: 'standard' },
    paymentId: String,
    status: { type: String, enum: ['pending', 'active', 'completed', 'expired'], default: 'pending' },
    enrolledAt: { type: Date, default: Date.now },
    expiresAt: Date,
    completedAt: Date
  });
  enrollmentSchema.index({ userId: 1, courseId: 1 });

  // 學習進度 Schema
  const progressSchema = new mongoose.Schema({
    userId: { type: String, required: true },
    courseId: { type: String, required: true },
    moduleId: String,
    lessonId: String,
    progress: { type: Number, default: 0 },  // 0-100
    completedLessons: [String],
    quizScores: [{
      quizId: String,
      score: Number,
      attemptedAt: Date
    }],
    totalTimeSpent: { type: Number, default: 0 },  // 秒
    lastAccessedAt: { type: Date, default: Date.now }
  });
  progressSchema.index({ userId: 1, courseId: 1 }, { unique: true });

  CourseEnrollment = mongoose.models.CourseEnrollment || mongoose.model('CourseEnrollment', enrollmentSchema);
  CourseProgress = mongoose.models.CourseProgress || mongoose.model('CourseProgress', progressSchema);
}

// ============================================================
// 課程列表 & 詳情
// ============================================================

/**
 * GET /api/courses
 * 取得所有課程列表
 */
router.get('/', (req, res) => {
  const courses = Object.values(COURSES).map(c => ({
    id: c.id,
    name: c.name,
    provider: c.provider,
    price: c.price,
    proPrice: c.proPrice,
    description: c.description,
    duration: c.duration,
    questionCount: c.questionCount,
    badge: c.badge
  }));
  
  res.json({
    success: true,
    data: courses
  });
});

/**
 * GET /api/courses/:courseId
 * 取得課程詳情
 */
router.get('/:courseId', (req, res) => {
  const { courseId } = req.params;
  const course = COURSES[courseId];
  
  if (!course) {
    return res.status(404).json({ success: false, error: '課程不存在' });
  }
  
  res.json({
    success: true,
    data: course
  });
});

// ============================================================
// 報名 & 付款
// ============================================================

/**
 * POST /api/courses/enroll
 * 報名課程
 */
router.post('/enroll', async (req, res) => {
  try {
    const { userId, courseId, tier = 'standard' } = req.body;
    
    if (!userId || !courseId) {
      return res.status(400).json({ success: false, error: '缺少必要欄位' });
    }
    
    const course = COURSES[courseId];
    if (!course) {
      return res.status(404).json({ success: false, error: '課程不存在' });
    }
    
    // 檢查是否已報名
    const existing = await CourseEnrollment.findOne({ 
      userId, 
      courseId, 
      status: { $in: ['pending', 'active'] } 
    });
    
    if (existing) {
      return res.status(400).json({ success: false, error: '已報名此課程' });
    }
    
    // 計算價格
    const price = tier === 'pro' ? course.proPrice : course.price;
    
    // 建立報名記錄（待付款）
    const enrollment = await CourseEnrollment.create({
      enrollmentId: `ENR_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 6)}`,
      userId,
      courseId,
      tier,
      status: 'pending',
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)  // 1年有效
    });
    
    res.json({
      success: true,
      data: {
        enrollmentId: enrollment.enrollmentId,
        courseId,
        courseName: course.name,
        tier,
        price,
        status: 'pending',
        message: '請完成付款以啟用課程'
      }
    });
  } catch (error) {
    console.error('Enroll error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/courses/activate
 * 啟用課程（付款成功後呼叫）
 */
router.post('/activate', async (req, res) => {
  try {
    const { enrollmentId, paymentId } = req.body;
    
    const enrollment = await CourseEnrollment.findOneAndUpdate(
      { enrollmentId, status: 'pending' },
      { 
        status: 'active',
        paymentId,
        enrolledAt: new Date()
      },
      { new: true }
    );
    
    if (!enrollment) {
      return res.status(404).json({ success: false, error: '報名記錄不存在或已啟用' });
    }
    
    // 建立學習進度記錄
    await CourseProgress.create({
      userId: enrollment.userId,
      courseId: enrollment.courseId,
      progress: 0,
      completedLessons: []
    });
    
    res.json({
      success: true,
      data: enrollment
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// 學習進度
// ============================================================

/**
 * GET /api/courses/:courseId/progress/:userId
 * 取得學習進度
 */
router.get('/:courseId/progress/:userId', async (req, res) => {
  try {
    const { courseId, userId } = req.params;
    
    // 檢查是否已報名
    const enrollment = await CourseEnrollment.findOne({ 
      userId, 
      courseId, 
      status: 'active' 
    });
    
    if (!enrollment) {
      return res.status(403).json({ success: false, error: '尚未報名或課程已過期' });
    }
    
    const progress = await CourseProgress.findOne({ userId, courseId });
    const course = COURSES[courseId];
    
    // 計算總課程數
    const totalLessons = course.modules.reduce((sum, m) => sum + m.lessons, 0);
    const completedCount = progress?.completedLessons?.length || 0;
    const overallProgress = Math.round((completedCount / totalLessons) * 100);
    
    res.json({
      success: true,
      data: {
        courseId,
        enrollment: {
          tier: enrollment.tier,
          enrolledAt: enrollment.enrolledAt,
          expiresAt: enrollment.expiresAt
        },
        progress: {
          overall: overallProgress,
          completedLessons: completedCount,
          totalLessons,
          timeSpent: progress?.totalTimeSpent || 0,
          lastAccessed: progress?.lastAccessedAt
        },
        modules: course.modules.map(m => ({
          ...m,
          completed: (progress?.completedLessons || []).filter(l => l.startsWith(m.id)).length
        })),
        quizScores: progress?.quizScores || []
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/courses/:courseId/progress
 * 更新學習進度
 */
router.post('/:courseId/progress', async (req, res) => {
  try {
    const { courseId } = req.params;
    const { userId, lessonId, timeSpent } = req.body;
    
    const update = {
      $set: { lastAccessedAt: new Date() },
      $addToSet: { completedLessons: lessonId },
      $inc: { totalTimeSpent: timeSpent || 0 }
    };
    
    const progress = await CourseProgress.findOneAndUpdate(
      { userId, courseId },
      update,
      { new: true, upsert: true }
    );
    
    res.json({
      success: true,
      data: progress
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/courses/:courseId/quiz
 * 提交測驗成績
 */
router.post('/:courseId/quiz', async (req, res) => {
  try {
    const { courseId } = req.params;
    const { userId, quizId, score } = req.body;
    
    const progress = await CourseProgress.findOneAndUpdate(
      { userId, courseId },
      {
        $push: {
          quizScores: {
            quizId,
            score,
            attemptedAt: new Date()
          }
        }
      },
      { new: true }
    );
    
    // 檢查是否通過
    const course = COURSES[courseId];
    const passed = score >= course.passingScore;
    
    res.json({
      success: true,
      data: {
        score,
        passingScore: course.passingScore,
        passed,
        badge: passed ? course.badge : null
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// 用戶課程列表
// ============================================================

/**
 * GET /api/courses/my/:userId
 * 取得用戶已報名的課程
 */
router.get('/my/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const enrollments = await CourseEnrollment.find({ 
      userId, 
      status: { $in: ['active', 'completed'] } 
    });
    
    const coursesWithProgress = await Promise.all(
      enrollments.map(async (e) => {
        const course = COURSES[e.courseId];
        const progress = await CourseProgress.findOne({ 
          userId, 
          courseId: e.courseId 
        });
        
        const totalLessons = course.modules.reduce((sum, m) => sum + m.lessons, 0);
        const completedCount = progress?.completedLessons?.length || 0;
        
        return {
          ...course,
          tier: e.tier,
          enrolledAt: e.enrolledAt,
          expiresAt: e.expiresAt,
          progress: Math.round((completedCount / totalLessons) * 100),
          status: e.status
        };
      })
    );
    
    res.json({
      success: true,
      data: coursesWithProgress
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// 初始化 & 導出
// ============================================================

router.initModels = initModels;
router.COURSES = COURSES;

module.exports = router;
