/**
 * GSAT 題庫 API v2.0
 * 北斗教育後端整合 - 支援 5 種題型
 * 
 * 新增端點：
 *   GET /api/v2/questions      - 統一題庫查詢
 *   GET /api/v2/types/:type    - 新題型查詢 (matching/ordering/fill_blank/multiple_select)
 *   GET /api/v2/mixed-exam     - 混合題型試卷
 *   POST /api/v2/check         - 通用答案驗證
 *   GET /api/v2/stats          - 完整統計
 */

const sqlite3 = require('better-sqlite3');
const path = require('path');

class GSATAPIv2 {
    constructor(dbPath) {
        this.dbPath = dbPath || path.join(__dirname, 'education.db');
        this.db = null;
    }

    connect() {
        if (!this.db) {
            this.db = new sqlite3(this.dbPath, { readonly: true });
        }
        return this;
    }

    close() {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }

    // ============================================================
    // 統一題庫 API
    // ============================================================

    /**
     * 從統一題庫取得題目
     * @param {Object} options
     * @param {string} options.subject - 科目
     * @param {string} options.level - 難度層級 (L1/L2/L3/L4)
     * @param {number} options.count - 題目數量
     * @param {boolean} options.shuffle - 是否隨機
     */
    getUnifiedQuestions(options = {}) {
        this.connect();
        
        const {
            subject = null,
            level = null,
            count = 10,
            shuffle = true
        } = options;

        let sql = `SELECT * FROM unified_question_bank WHERE 1=1`;
        const params = [];

        if (subject) {
            sql += ` AND subject = ?`;
            params.push(subject);
        }

        if (level) {
            sql += ` AND exam_level = ?`;
            params.push(level);
        }

        if (shuffle) {
            sql += ` ORDER BY RANDOM()`;
        }

        sql += ` LIMIT ?`;
        params.push(count);

        const rows = this.db.prepare(sql).all(...params);
        
        return rows.map(row => ({
            id: row.id,
            type: 'single_choice',
            subject: row.subject,
            topic: row.topic,
            level: row.exam_level,
            stem: row.stem,
            options: JSON.parse(row.options || '[]'),
            answer: row.answer,
            explanation: row.explanation,
            difficulty: row.difficulty,
            quality: row.quality_score
        }));
    }

    // ============================================================
    // 新題型 API
    // ============================================================

    /**
     * 取得新題型題目
     * @param {string} questionType - 題型 (matching/ordering/fill_blank/multiple_select)
     * @param {Object} options
     */
    getNewTypeQuestions(questionType, options = {}) {
        this.connect();
        
        const {
            subject = null,
            count = 10,
            shuffle = true
        } = options;

        let sql = `SELECT * FROM new_question_types WHERE question_type = ?`;
        const params = [questionType];

        if (subject) {
            sql += ` AND subject = ?`;
            params.push(subject);
        }

        if (shuffle) {
            sql += ` ORDER BY RANDOM()`;
        }

        sql += ` LIMIT ?`;
        params.push(count);

        const rows = this.db.prepare(sql).all(...params);
        
        return rows.map(row => this._formatNewType(row));
    }

    _formatNewType(row) {
        const base = {
            id: row.id,
            type: row.question_type,
            subject: row.subject,
            template: row.template_key,
            difficulty: row.difficulty
        };

        switch (row.question_type) {
            case 'matching':
                const items = JSON.parse(row.items_json);
                return {
                    ...base,
                    instruction: row.stem,
                    leftItems: items.left,
                    rightItems: items.right,
                    answer: JSON.parse(row.answer_json)
                };

            case 'ordering':
                return {
                    ...base,
                    instruction: row.stem,
                    items: JSON.parse(row.items_json),
                    answer: JSON.parse(row.answer_json)
                };

            case 'fill_blank':
                return {
                    ...base,
                    stem: row.stem,
                    hint: JSON.parse(row.items_json).hint || '',
                    answer: JSON.parse(row.answer_json)
                };

            case 'multiple_select':
                return {
                    ...base,
                    stem: row.stem,
                    options: JSON.parse(row.items_json),
                    answer: JSON.parse(row.answer_json)
                };

            default:
                return base;
        }
    }

    // ============================================================
    // 混合試卷
    // ============================================================

    /**
     * 生成混合題型試卷
     * @param {string} subject - 科目
     * @param {Object} composition - 題型組成 { single: 10, matching: 2, ordering: 2, fill_blank: 3, multiple_select: 3 }
     */
    getMixedExam(subject, composition = {}) {
        this.connect();

        const defaultComposition = {
            single: 10,
            matching: 2,
            ordering: 2,
            fill_blank: 3,
            multiple_select: 3
        };

        const comp = { ...defaultComposition, ...composition };
        const questions = [];

        // 單選題
        if (comp.single > 0) {
            questions.push(...this.getUnifiedQuestions({
                subject,
                count: comp.single,
                shuffle: true
            }));
        }

        // 配對題
        if (comp.matching > 0) {
            questions.push(...this.getNewTypeQuestions('matching', {
                subject,
                count: comp.matching
            }));
        }

        // 排序題
        if (comp.ordering > 0) {
            questions.push(...this.getNewTypeQuestions('ordering', {
                subject,
                count: comp.ordering
            }));
        }

        // 填空題
        if (comp.fill_blank > 0) {
            questions.push(...this.getNewTypeQuestions('fill_blank', {
                subject,
                count: comp.fill_blank
            }));
        }

        // 多選題
        if (comp.multiple_select > 0) {
            questions.push(...this.getNewTypeQuestions('multiple_select', {
                subject,
                count: comp.multiple_select
            }));
        }

        return {
            subject,
            composition: comp,
            totalQuestions: questions.length,
            questions,
            generatedAt: new Date().toISOString()
        };
    }

    // ============================================================
    // 答案驗證
    // ============================================================

    /**
     * 驗證答案 (支援所有題型)
     * @param {string} type - 題型
     * @param {number} questionId - 題目ID
     * @param {any} userAnswer - 使用者答案
     */
    checkAnswer(type, questionId, userAnswer) {
        this.connect();

        if (type === 'single_choice') {
            const row = this.db.prepare(`
                SELECT answer, explanation FROM unified_question_bank WHERE id = ?
            `).get(questionId);

            if (!row) return { valid: false, error: 'Question not found' };

            return {
                valid: true,
                correct: row.answer === userAnswer,
                correctAnswer: row.answer,
                explanation: row.explanation
            };
        }

        // 新題型
        const row = this.db.prepare(`
            SELECT answer_json, question_type FROM new_question_types WHERE id = ?
        `).get(questionId);

        if (!row) return { valid: false, error: 'Question not found' };

        const correctAnswer = JSON.parse(row.answer_json);
        let correct = false;
        let score = 0;

        switch (row.question_type) {
            case 'matching':
            case 'ordering':
                // 陣列完全相等
                correct = JSON.stringify(userAnswer) === JSON.stringify(correctAnswer);
                score = correct ? 100 : 0;
                break;

            case 'fill_blank':
                // 字串/數值比對
                correct = String(userAnswer).toLowerCase() === String(correctAnswer).toLowerCase();
                score = correct ? 100 : 0;
                break;

            case 'multiple_select':
                // 部分給分
                const userSet = new Set(userAnswer);
                const correctSet = new Set(correctAnswer);
                const correctCount = [...userSet].filter(x => correctSet.has(x)).length;
                const wrongCount = [...userSet].filter(x => !correctSet.has(x)).length;
                
                if (wrongCount === 0 && correctCount === correctSet.size) {
                    score = 100;
                    correct = true;
                } else if (wrongCount <= 1) {
                    score = 60;
                } else if (wrongCount <= 2) {
                    score = 20;
                } else {
                    score = 0;
                }
                break;
        }

        return {
            valid: true,
            correct,
            score,
            correctAnswer,
            userAnswer
        };
    }

    // ============================================================
    // 統計
    // ============================================================

    /**
     * 取得完整統計
     */
    getFullStats() {
        this.connect();

        // 統一題庫統計
        const unifiedStats = this.db.prepare(`
            SELECT 
                subject,
                exam_level,
                COUNT(*) as total,
                ROUND(AVG(quality_score), 1) as avgQuality
            FROM unified_question_bank
            GROUP BY subject, exam_level
            ORDER BY subject, exam_level
        `).all();

        // 新題型統計
        const newTypeStats = this.db.prepare(`
            SELECT 
                question_type,
                subject,
                COUNT(*) as total
            FROM new_question_types
            GROUP BY question_type, subject
            ORDER BY question_type, subject
        `).all();

        // 總計
        const unifiedTotal = this.db.prepare(`SELECT COUNT(*) as c FROM unified_question_bank`).get().c;
        const newTypeTotal = this.db.prepare(`SELECT COUNT(*) as c FROM new_question_types`).get().c;

        return {
            unified: {
                total: unifiedTotal,
                bySubjectLevel: unifiedStats
            },
            newTypes: {
                total: newTypeTotal,
                byTypeSubject: newTypeStats
            },
            grandTotal: unifiedTotal + newTypeTotal
        };
    }
}

// ============================================================
// Express 路由
// ============================================================

function setupRoutesV2(app, dbPath) {
    const api = new GSATAPIv2(dbPath);

    // GET /api/v2/questions?subject=數學&level=L2&count=10
    app.get('/api/v2/questions', (req, res) => {
        try {
            const questions = api.getUnifiedQuestions({
                subject: req.query.subject,
                level: req.query.level,
                count: parseInt(req.query.count) || 10
            });
            res.json({ success: true, data: questions });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // GET /api/v2/types/:type?subject=國文&count=5
    app.get('/api/v2/types/:type', (req, res) => {
        try {
            const validTypes = ['matching', 'ordering', 'fill_blank', 'multiple_select'];
            if (!validTypes.includes(req.params.type)) {
                return res.status(400).json({ 
                    success: false, 
                    error: `Invalid type. Use: ${validTypes.join(', ')}` 
                });
            }

            const questions = api.getNewTypeQuestions(req.params.type, {
                subject: req.query.subject,
                count: parseInt(req.query.count) || 10
            });
            res.json({ success: true, data: questions });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // GET /api/v2/mixed-exam/:subject?single=10&matching=2&...
    app.get('/api/v2/mixed-exam/:subject', (req, res) => {
        try {
            const composition = {
                single: parseInt(req.query.single) || 10,
                matching: parseInt(req.query.matching) || 2,
                ordering: parseInt(req.query.ordering) || 2,
                fill_blank: parseInt(req.query.fill_blank) || 3,
                multiple_select: parseInt(req.query.multiple_select) || 3
            };

            const exam = api.getMixedExam(req.params.subject, composition);
            res.json({ success: true, data: exam });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // POST /api/v2/check
    app.post('/api/v2/check', (req, res) => {
        try {
            const { type, questionId, answer } = req.body;
            const result = api.checkAnswer(type, questionId, answer);
            res.json({ success: true, data: result });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    // GET /api/v2/stats
    app.get('/api/v2/stats', (req, res) => {
        try {
            const stats = api.getFullStats();
            res.json({ success: true, data: stats });
        } catch (err) {
            res.status(500).json({ success: false, error: err.message });
        }
    });

    return api;
}

module.exports = { GSATAPIv2, setupRoutesV2 };
