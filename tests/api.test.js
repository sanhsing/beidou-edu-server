/**
 * 北斗教育 API 測試腳本
 * 使用 Jest + Supertest
 * 
 * 安裝: npm install --save-dev jest supertest
 * 執行: npm test
 */

const request = require('supertest');

// 測試環境設定
const API_BASE = process.env.API_BASE || 'https://beidou-edu-server-1.onrender.com';

describe('北斗教育 API 測試', () => {
  
  // ============================================================
  // 健康檢查
  // ============================================================
  
  describe('健康檢查 /health', () => {
    test('應返回 status ok', async () => {
      const res = await request(API_BASE)
        .get('/health')
        .expect(200);
      
      expect(res.body.status).toBe('ok');
      expect(res.body).toHaveProperty('database');
    });
  });
  
  // ============================================================
  // 題庫 API
  // ============================================================
  
  describe('題庫 API /api/quiz', () => {
    
    test('GET /api/quiz/stats 應返回統計', async () => {
      const res = await request(API_BASE)
        .get('/api/quiz/stats')
        .expect(200);
      
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('total');
      expect(res.body.data).toHaveProperty('layers');
      expect(res.body.data).toHaveProperty('subjects');
    });
    
    test('GET /api/quiz/subjects 應返回科目列表', async () => {
      const res = await request(API_BASE)
        .get('/api/quiz/subjects')
        .expect(200);
      
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);
    });
    
    test('GET /api/quiz/random 應返回隨機題目', async () => {
      const res = await request(API_BASE)
        .get('/api/quiz/random?limit=5')
        .expect(200);
      
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeLessThanOrEqual(5);
    });
    
    test('GET /api/quiz/random?subject=數學 應返回數學題', async () => {
      const res = await request(API_BASE)
        .get('/api/quiz/random?subject=' + encodeURIComponent('數學') + '&limit=3')
        .expect(200);
      
      expect(res.body.success).toBe(true);
      if (res.body.data.length > 0) {
        expect(res.body.data[0].subject).toBe('數學');
      }
    });
    
    test('GET /api/quiz/question/:id 應返回題目詳情', async () => {
      // 先取得一題
      const randomRes = await request(API_BASE)
        .get('/api/quiz/random?limit=1')
        .expect(200);
      
      if (randomRes.body.data && randomRes.body.data.length > 0) {
        const questionId = randomRes.body.data[0].id;
        
        const res = await request(API_BASE)
          .get(`/api/quiz/question/${questionId}`)
          .expect(200);
        
        expect(res.body.success).toBe(true);
        expect(res.body.data).toHaveProperty('question');
      }
    });
  });
  
  // ============================================================
  // 用戶 API
  // ============================================================
  
  describe('用戶 API /api/user', () => {
    const testEmail = `test_${Date.now()}@example.com`;
    const testPassword = 'test123456';
    let testUserId = null;
    let testToken = null;
    
    test('POST /api/user/register 應註冊新用戶', async () => {
      const res = await request(API_BASE)
        .post('/api/user/register')
        .send({
          email: testEmail,
          password: testPassword,
          displayName: '測試用戶'
        })
        .expect(200);
      
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('userId');
      expect(res.body.data).toHaveProperty('token');
      
      testUserId = res.body.data.userId;
      testToken = res.body.data.token;
    });
    
    test('POST /api/user/login 應登入成功', async () => {
      const res = await request(API_BASE)
        .post('/api/user/login')
        .send({
          email: testEmail,
          password: testPassword
        })
        .expect(200);
      
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('token');
    });
    
    test('POST /api/user/login 錯誤密碼應失敗', async () => {
      const res = await request(API_BASE)
        .post('/api/user/login')
        .send({
          email: testEmail,
          password: 'wrongpassword'
        });
      
      expect(res.body.success).toBe(false);
    });
    
    test('GET /api/user/profile/:userId 應返回用戶資料', async () => {
      if (!testUserId) {
        console.log('跳過：無測試用戶');
        return;
      }
      
      const res = await request(API_BASE)
        .get(`/api/user/profile/${testUserId}`)
        .expect(200);
      
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('email');
    });
  });
  
  // ============================================================
  // 成就 API
  // ============================================================
  
  describe('成就 API /api/achievements', () => {
    
    test('GET /api/achievements 應返回成就列表', async () => {
      const res = await request(API_BASE)
        .get('/api/achievements')
        .expect(200);
      
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });
  
  // ============================================================
  // 課程 API
  // ============================================================
  
  describe('課程 API /api/courses', () => {
    
    test('GET /api/courses 應返回課程列表', async () => {
      const res = await request(API_BASE)
        .get('/api/courses')
        .expect(200);
      
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
    
    test('GET /api/courses/:id 應返回課程詳情', async () => {
      const res = await request(API_BASE)
        .get('/api/courses/google-ai')
        .expect(200);
      
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('courseId');
    });
  });
  
  // ============================================================
  // 班級 API
  // ============================================================
  
  describe('班級 API /api/class', () => {
    
    test('GET /api/class/user/:userId 無班級應返回空陣列', async () => {
      const res = await request(API_BASE)
        .get('/api/class/user/nonexistent_user')
        .expect(200);
      
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });
  
  // ============================================================
  // 錯誤處理
  // ============================================================
  
  describe('錯誤處理', () => {
    
    test('不存在的路徑應返回 404', async () => {
      const res = await request(API_BASE)
        .get('/api/nonexistent')
        .expect(404);
      
      expect(res.body.success).toBe(false);
    });
    
    test('缺少必要參數應返回錯誤', async () => {
      const res = await request(API_BASE)
        .post('/api/user/register')
        .send({})
        .expect(400);
      
      expect(res.body.success).toBe(false);
    });
  });
});

// ============================================================
// 效能測試
// ============================================================

describe('效能測試', () => {
  
  test('API 響應時間應小於 2 秒', async () => {
    const start = Date.now();
    
    await request(API_BASE)
      .get('/api/quiz/subjects')
      .expect(200);
    
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(2000);
  });
  
  test('批量請求不應超時', async () => {
    const promises = Array(5).fill().map(() => 
      request(API_BASE).get('/api/quiz/random?limit=10')
    );
    
    const results = await Promise.all(promises);
    results.forEach(res => {
      expect(res.status).toBe(200);
    });
  });
});
