/**
 * 北斗教育 - 認證系統前端元件
 * v53 新增
 */

import React, { useState, useEffect } from 'react';

// ============================================================
// L1: CertList - 認證列表卡片
// ============================================================

export function CertList({ onSelect }) {
  const [certs, setCerts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/cert/list')
      .then(r => r.json())
      .then(d => {
        if (d.success) setCerts(d.data);
        setLoading(false);
      });
  }, []);

  const certIcons = {
    'google_ai': '🔵',
    'aws_ai': '🟠',
    'azure_ai': '🔷',
    'ipas': '🛡️'
  };

  const diffColors = {
    'beginner': 'bg-green-100 text-green-800',
    'intermediate': 'bg-yellow-100 text-yellow-800',
    'advanced': 'bg-red-100 text-red-800'
  };

  if (loading) return <div className="animate-pulse">載入中...</div>;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {certs.map(cert => (
        <div 
          key={cert.cert_key}
          onClick={() => onSelect?.(cert)}
          className="bg-white rounded-xl shadow-lg p-6 cursor-pointer 
                     hover:shadow-xl transition-shadow border-l-4"
          style={{ borderColor: cert.cert_key.includes('google') ? '#4285F4' :
                               cert.cert_key.includes('aws') ? '#FF9900' :
                               cert.cert_key.includes('azure') ? '#0078D4' : '#6B7280' }}
        >
          <div className="flex items-start justify-between">
            <div>
              <span className="text-2xl mr-2">{certIcons[cert.cert_key] || '📜'}</span>
              <h3 className="text-lg font-bold inline">{cert.name}</h3>
            </div>
            <span className={`px-2 py-1 rounded-full text-xs ${diffColors[cert.difficulty] || 'bg-gray-100'}`}>
              {cert.difficulty}
            </span>
          </div>
          
          <p className="text-gray-600 mt-2 text-sm">{cert.description}</p>
          
          <div className="flex gap-4 mt-4 text-sm text-gray-500">
            <span>📚 {cert.term_count} 術語</span>
            <span>📝 {cert.question_count} 題</span>
            <span>⏱️ {cert.duration_weeks} 週</span>
          </div>
          
          <div className="mt-4">
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div className="bg-blue-600 h-2 rounded-full" style={{ width: '0%' }}></div>
            </div>
            <span className="text-xs text-gray-400">學習進度 0%</span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// L2: CertPath - 學習路徑樹狀圖
// ============================================================

export function CertPath({ certKey }) {
  const [pathData, setPathData] = useState(null);
  const [expanded, setExpanded] = useState({});

  useEffect(() => {
    if (!certKey) return;
    fetch(`/api/cert/${certKey}/path`)
      .then(r => r.json())
      .then(d => {
        if (d.success) setPathData(d.data);
      });
  }, [certKey]);

  const toggleDomain = (domain) => {
    setExpanded(prev => ({ ...prev, [domain]: !prev[domain] }));
  };

  if (!pathData) return <div>選擇認證課程</div>;

  return (
    <div className="bg-white rounded-xl shadow p-6">
      <h2 className="text-xl font-bold mb-4">{pathData.cert.name}</h2>
      <p className="text-gray-600 mb-6">{pathData.cert.description}</p>
      
      <div className="space-y-3">
        {pathData.domains.map((domain, i) => (
          <div key={i} className="border rounded-lg">
            <button 
              onClick={() => toggleDomain(domain.name)}
              className="w-full p-4 flex justify-between items-center hover:bg-gray-50"
            >
              <span className="font-medium">
                {expanded[domain.name] ? '📂' : '📁'} {domain.name}
              </span>
              <span className="text-sm text-gray-500">{domain.topics.length} 主題</span>
            </button>
            
            {expanded[domain.name] && (
              <div className="px-4 pb-4 space-y-2">
                {domain.topics.map((topic, j) => (
                  <div key={j} className="flex items-center gap-2 text-sm py-1 px-2 
                                          hover:bg-blue-50 rounded cursor-pointer">
                    <span className="text-gray-400">○</span>
                    <span>{topic}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// L3: GlossarySearch - 術語搜尋
// ============================================================

export function GlossarySearch({ certKey }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);

  const handleSearch = async () => {
    if (query.length < 2) return;
    setSearching(true);
    
    const url = certKey 
      ? `/api/cert/glossary/search?q=${query}&cert=${certKey}`
      : `/api/cert/glossary/search?q=${query}`;
    
    const r = await fetch(url);
    const d = await r.json();
    if (d.success) setResults(d.data.results);
    setSearching(false);
  };

  return (
    <div className="bg-white rounded-xl shadow p-6">
      <h3 className="font-bold mb-4">🔍 術語搜尋</h3>
      
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyPress={e => e.key === 'Enter' && handleSearch()}
          placeholder="輸入關鍵字..."
          className="flex-1 border rounded-lg px-4 py-2"
        />
        <button 
          onClick={handleSearch}
          disabled={searching}
          className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700"
        >
          {searching ? '⏳' : '搜尋'}
        </button>
      </div>
      
      <div className="space-y-3 max-h-96 overflow-y-auto">
        {results.map(term => (
          <div key={term.id} className="border-l-4 border-blue-500 pl-4 py-2">
            <div className="font-medium">{term.term}</div>
            {term.term_zh && <div className="text-sm text-gray-600">{term.term_zh}</div>}
            <div className="text-sm text-gray-500 mt-1">{term.definition}</div>
            <span className="text-xs bg-gray-100 px-2 py-0.5 rounded mt-1 inline-block">
              {term.certification}
            </span>
          </div>
        ))}
        {results.length === 0 && query.length >= 2 && !searching && (
          <div className="text-gray-400 text-center py-8">無搜尋結果</div>
        )}
      </div>
    </div>
  );
}

// ============================================================
// L4: ExamSimulator - 模擬考介面
// ============================================================

export function ExamSimulator({ certKey, userId }) {
  const [exam, setExam] = useState(null);
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [timeLeft, setTimeLeft] = useState(0);

  const startExam = async () => {
    const r = await fetch('/api/cert/exam/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId, cert_key: certKey, count: 20 })
    });
    const d = await r.json();
    if (d.success) {
      setExam(d.data);
      setTimeLeft(d.data.time_limit);
      setAnswers({});
      setResult(null);
      setCurrent(0);
    }
  };

  const selectAnswer = (qid, answer) => {
    setAnswers(prev => ({ ...prev, [qid]: answer }));
  };

  const submitExam = async () => {
    const r = await fetch('/api/cert/exam/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ exam_id: exam.exam_id, answers })
    });
    const d = await r.json();
    if (d.success) setResult(d.data);
  };

  // 倒數計時
  useEffect(() => {
    if (!exam || timeLeft <= 0) return;
    const timer = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) {
          submitExam();
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [exam]);

  if (result) {
    return (
      <div className="bg-white rounded-xl shadow p-8 text-center">
        <div className="text-6xl mb-4">{result.passed ? '🎉' : '📚'}</div>
        <h2 className="text-2xl font-bold mb-2">
          {result.passed ? '恭喜通過！' : '再接再厲！'}
        </h2>
        <div className="text-4xl font-bold text-blue-600 mb-4">{result.score} 分</div>
        <div className="text-gray-600">
          答對 {result.correct} / {result.total} 題
        </div>
        <button 
          onClick={() => { setExam(null); setResult(null); }}
          className="mt-6 bg-blue-600 text-white px-8 py-3 rounded-lg"
        >
          再試一次
        </button>
      </div>
    );
  }

  if (!exam) {
    return (
      <div className="bg-white rounded-xl shadow p-8 text-center">
        <div className="text-6xl mb-4">📝</div>
        <h2 className="text-xl font-bold mb-4">模擬考試</h2>
        <p className="text-gray-600 mb-6">共 20 題，每題 90 秒</p>
        <button 
          onClick={startExam}
          className="bg-blue-600 text-white px-8 py-3 rounded-lg text-lg hover:bg-blue-700"
        >
          開始考試
        </button>
      </div>
    );
  }

  const q = exam.questions[current];
  const options = typeof q.options === 'string' ? JSON.parse(q.options) : q.options;

  return (
    <div className="bg-white rounded-xl shadow p-6">
      {/* 進度條 */}
      <div className="flex justify-between items-center mb-4">
        <span className="text-sm text-gray-500">
          第 {current + 1} / {exam.questions.length} 題
        </span>
        <span className={`font-mono ${timeLeft < 60 ? 'text-red-600' : ''}`}>
          ⏱️ {Math.floor(timeLeft / 60)}:{(timeLeft % 60).toString().padStart(2, '0')}
        </span>
      </div>
      
      <div className="w-full bg-gray-200 rounded-full h-2 mb-6">
        <div 
          className="bg-blue-600 h-2 rounded-full transition-all"
          style={{ width: `${((current + 1) / exam.questions.length) * 100}%` }}
        ></div>
      </div>
      
      {/* 題目 */}
      <div className="mb-6">
        <p className="text-lg font-medium">{q.question}</p>
      </div>
      
      {/* 選項 */}
      <div className="space-y-3 mb-6">
        {options.map((opt, i) => (
          <button
            key={i}
            onClick={() => selectAnswer(q.id, i)}
            className={`w-full text-left p-4 rounded-lg border-2 transition-all
              ${answers[q.id] === i 
                ? 'border-blue-600 bg-blue-50' 
                : 'border-gray-200 hover:border-gray-300'}`}
          >
            <span className="font-medium mr-2">{String.fromCharCode(65 + i)}.</span>
            {opt}
          </button>
        ))}
      </div>
      
      {/* 導航 */}
      <div className="flex justify-between">
        <button
          onClick={() => setCurrent(c => Math.max(0, c - 1))}
          disabled={current === 0}
          className="px-6 py-2 rounded-lg border disabled:opacity-50"
        >
          上一題
        </button>
        
        {current < exam.questions.length - 1 ? (
          <button
            onClick={() => setCurrent(c => c + 1)}
            className="px-6 py-2 rounded-lg bg-blue-600 text-white"
          >
            下一題
          </button>
        ) : (
          <button
            onClick={submitExam}
            className="px-6 py-2 rounded-lg bg-green-600 text-white"
          >
            交卷
          </button>
        )}
      </div>
    </div>
  );
}

// ============================================================
// L5: ProgressDashboard - 進度儀表板
// ============================================================

export function ProgressDashboard({ userId }) {
  const [progress, setProgress] = useState(null);

  useEffect(() => {
    if (!userId) return;
    fetch(`/api/cert/progress/${userId}`)
      .then(r => r.json())
      .then(d => {
        if (d.success) setProgress(d.data);
      });
  }, [userId]);

  if (!progress) return <div>載入進度中...</div>;

  return (
    <div className="bg-white rounded-xl shadow p-6">
      <h3 className="font-bold text-lg mb-4">📊 學習進度</h3>
      
      {Object.entries(progress.stats).map(([cert, stat]) => {
        const pct = stat.total > 0 ? Math.round(100 * stat.completed / stat.total) : 0;
        return (
          <div key={cert} className="mb-4">
            <div className="flex justify-between text-sm mb-1">
              <span className="font-medium">{cert}</span>
              <span>{stat.completed}/{stat.total} ({pct}%)</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3">
              <div 
                className="bg-green-500 h-3 rounded-full transition-all"
                style={{ width: `${pct}%` }}
              ></div>
            </div>
          </div>
        );
      })}
      
      {Object.keys(progress.stats).length === 0 && (
        <div className="text-gray-400 text-center py-8">
          尚未開始學習任何認證
        </div>
      )}
    </div>
  );
}

// ============================================================
// 主頁面: CertificationPage
// ============================================================

export default function CertificationPage({ userId = 1 }) {
  const [selectedCert, setSelectedCert] = useState(null);
  const [tab, setTab] = useState('list');  // list, path, glossary, exam

  return (
    <div className="min-h-screen bg-gray-100 p-4">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-2xl font-bold mb-6">🎓 AI 認證中心</h1>
        
        {/* 導航 */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
          {['list', 'path', 'glossary', 'exam'].map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-lg whitespace-nowrap
                ${tab === t ? 'bg-blue-600 text-white' : 'bg-white'}`}
            >
              {t === 'list' && '📚 認證列表'}
              {t === 'path' && '🗺️ 學習路徑'}
              {t === 'glossary' && '🔍 術語查詢'}
              {t === 'exam' && '📝 模擬考試'}
            </button>
          ))}
        </div>
        
        {/* 內容 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2">
            {tab === 'list' && <CertList onSelect={c => { setSelectedCert(c); setTab('path'); }} />}
            {tab === 'path' && <CertPath certKey={selectedCert?.cert_key} />}
            {tab === 'glossary' && <GlossarySearch certKey={selectedCert?.cert_key} />}
            {tab === 'exam' && <ExamSimulator certKey={selectedCert?.cert_key} userId={userId} />}
          </div>
          
          <div>
            <ProgressDashboard userId={userId} />
          </div>
        </div>
      </div>
    </div>
  );
}
