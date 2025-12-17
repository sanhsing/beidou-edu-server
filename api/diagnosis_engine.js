/**
 * 北斗教育 - 弱點診斷引擎
 * XTF-KG 智能學習推薦
 * 2025-12-16
 */

// ============================================================
// 診斷核心邏輯
// ============================================================

/**
 * 分析考試結果，識別弱點
 * @param {Object} examResult - 考試結果
 * @param {Object} db - 資料庫連接
 * @returns {Object} 診斷報告
 */
async function diagnoseWeakness(examResult, db) {
  const { cert_id, results, domain_stats } = examResult;
  
  // 1. 識別弱項領域 (低於 70% 的領域)
  const weakDomains = domain_stats
    .filter(d => d.percentage < 70)
    .sort((a, b) => a.percentage - b.percentage);
  
  // 2. 收集錯題對應的知識點
  const wrongQuestions = results.filter(r => !r.is_correct);
  const wrongNodeIds = [...new Set(wrongQuestions.map(q => q.node_id).filter(Boolean))];
  
  // 3. 查詢弱點節點的前置知識
  const prerequisiteGaps = [];
  const isIPAS = cert_id.startsWith('IPAS');
  const xtfTable = isIPAS ? 'ipas_xtf_knowledge' : 'ai_cert_xtf_knowledge';
  
  for (const nodeId of wrongNodeIds) {
    const row = await dbGet(db, `SELECT * FROM ${xtfTable} WHERE node_id = ?`, [nodeId]);
    if (row && row.t_prerequisites) {
      const prereqs = JSON.parse(row.t_prerequisites);
      prereqs.forEach(p => {
        if (!prerequisiteGaps.includes(p)) {
          prerequisiteGaps.push(p);
        }
      });
    }
  }
  
  // 4. 生成推薦學習節點 (按樞紐分數排序)
  let recommendedNodes = [];
  if (prerequisiteGaps.length > 0) {
    const placeholders = prerequisiteGaps.map(() => '?').join(',');
    const rows = await dbAll(db, `
      SELECT node_id, x_plain, f_mnemonics, t_hub_score 
      FROM ${xtfTable} 
      WHERE node_id IN (${placeholders})
      ORDER BY t_hub_score DESC
    `, prerequisiteGaps);
    recommendedNodes = rows;
  }
  
  // 5. 生成學習路徑
  const learningPath = generateLearningPath(weakDomains, prerequisiteGaps, wrongNodeIds);
  
  return {
    weak_domains: weakDomains,
    weak_nodes: wrongNodeIds,
    prerequisite_gaps: prerequisiteGaps,
    recommended_nodes: recommendedNodes,
    recommended_path: learningPath,
    summary: generateDiagnosisSummary(weakDomains, prerequisiteGaps)
  };
}

/**
 * 生成學習路徑
 */
function generateLearningPath(weakDomains, prerequisites, weakNodes) {
  const path = [];
  
  // Step 1: 先補前置知識
  prerequisites.forEach((node, idx) => {
    path.push({
      step: idx + 1,
      type: 'prerequisite',
      node_id: node,
      description: '補強前置知識'
    });
  });
  
  // Step 2: 再複習弱點
  weakNodes.forEach((node, idx) => {
    path.push({
      step: prerequisites.length + idx + 1,
      type: 'weak_point',
      node_id: node,
      description: '重點複習'
    });
  });
  
  // Step 3: 練習題
  path.push({
    step: path.length + 1,
    type: 'practice',
    description: '針對弱項領域做練習題'
  });
  
  return path;
}

/**
 * 生成診斷摘要
 */
function generateDiagnosisSummary(weakDomains, prerequisites) {
  const parts = [];
  
  if (weakDomains.length === 0) {
    parts.push('🎉 恭喜！各領域表現均衡，繼續保持！');
  } else {
    parts.push(`📊 發現 ${weakDomains.length} 個弱項領域需要加強：`);
    weakDomains.slice(0, 3).forEach(d => {
      parts.push(`  • ${d.domain} (${d.percentage}%)`);
    });
  }
  
  if (prerequisites.length > 0) {
    parts.push(`\n📚 建議先複習 ${prerequisites.length} 個前置知識點`);
  }
  
  return parts.join('\n');
}

// ============================================================
// API 路由擴展
// ============================================================

/**
 * POST /api/cert/diagnose
 * 診斷弱點
 */
async function diagnoseHandler(req, res, db) {
  try {
    const { user_id, cert_id, exam_result } = req.body;
    
    if (!cert_id || !exam_result) {
      return res.status(400).json({ success: false, error: 'Missing parameters' });
    }
    
    // 執行診斷
    const diagnosis = await diagnoseWeakness(exam_result, db);
    
    // 儲存診斷結果
    const sessionId = `diag_${Date.now()}`;
    await dbRun(db, `
      INSERT INTO cert_diagnosis 
      (user_id, cert_id, session_id, total_questions, correct_count, wrong_count, score,
       weak_domains, weak_nodes, prerequisite_gaps, recommended_nodes, recommended_path, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      user_id || 'anonymous',
      cert_id,
      sessionId,
      exam_result.total,
      exam_result.correct,
      exam_result.wrong,
      exam_result.score,
      JSON.stringify(diagnosis.weak_domains),
      JSON.stringify(diagnosis.weak_nodes),
      JSON.stringify(diagnosis.prerequisite_gaps),
      JSON.stringify(diagnosis.recommended_nodes),
      JSON.stringify(diagnosis.recommended_path),
      new Date().toISOString()
    ]);
    
    res.json({
      success: true,
      data: {
        session_id: sessionId,
        ...diagnosis
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

/**
 * GET /api/cert/recommend/:nodeId
 * 取得學習推薦
 */
async function recommendHandler(req, res, db) {
  try {
    const { nodeId } = req.params;
    const { cert_type = 'ai' } = req.query;
    
    const xtfTable = cert_type === 'ipas' ? 'ipas_xtf_knowledge' : 'ai_cert_xtf_knowledge';
    
    // 取得節點資訊
    const node = await dbGet(db, `SELECT * FROM ${xtfTable} WHERE node_id = ?`, [nodeId]);
    
    if (!node) {
      return res.status(404).json({ success: false, error: 'Node not found' });
    }
    
    // 解析關係
    const prerequisites = JSON.parse(node.t_prerequisites || '[]');
    const nextNodes = JSON.parse(node.t_next_nodes || '[]');
    const related = JSON.parse(node.t_related || '[]');
    const confusedWith = JSON.parse(node.t_confused_with || '[]');
    
    // 取得相關節點詳情
    const allRelated = [...prerequisites, ...nextNodes, ...related];
    let relatedDetails = [];
    
    if (allRelated.length > 0) {
      const placeholders = allRelated.map(() => '?').join(',');
      relatedDetails = await dbAll(db, `
        SELECT node_id, x_plain, f_mnemonics, t_hub_score 
        FROM ${xtfTable} 
        WHERE node_id IN (${placeholders})
      `, allRelated);
    }
    
    res.json({
      success: true,
      data: {
        current: {
          node_id: node.node_id,
          plain: node.x_plain,
          mnemonics: node.f_mnemonics,
          hub_score: node.t_hub_score
        },
        learn_first: relatedDetails.filter(n => prerequisites.includes(n.node_id)),
        learn_next: relatedDetails.filter(n => nextNodes.includes(n.node_id)),
        also_see: relatedDetails.filter(n => related.includes(n.node_id)),
        confused_with: confusedWith
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
}

// ============================================================
// 輔助函數
// ============================================================

function dbGet(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function dbAll(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

function dbRun(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}

// ============================================================
// 導出
// ============================================================

module.exports = {
  diagnoseWeakness,
  diagnoseHandler,
  recommendHandler,
  generateLearningPath
};
