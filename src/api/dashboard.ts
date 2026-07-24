// 前端看板页面
import type { Env } from '../index';

export async function handleDashboard(env: Env): Promise<Response> {
  const html = DASHBOARD_HTML;
  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ECO GEO 监测看板</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    .score-0 { background: #fee2e2; color: #991b1b; }
    .score-1 { background: #fef3c7; color: #92400e; }
    .score-2 { background: #d1fae5; color: #065f46; }
    .score-3 { background: #a7f3d0; color: #047857; font-weight: 700; }
    .card { background: white; border-radius: 12px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  </style>
</head>
<body class="bg-gray-50 min-h-screen">
  <header class="bg-white border-b px-6 py-4">
    <h1 class="text-xl font-bold text-gray-800">ECO GEO 品牌 AI 监测看板</h1>
    <p class="text-sm text-gray-500 mt-1">追踪品牌在 6 家 AI 中的推荐表现</p>
  </header>

  <main class="max-w-7xl mx-auto px-6 py-6 space-y-6">
    <!-- 筛选栏 -->
    <div class="flex gap-4 items-center flex-wrap">
      <label class="text-sm text-gray-600">周次：</label>
      <input type="week" id="weekPicker" class="border rounded px-3 py-1.5 text-sm">
      <button onclick="loadData()" class="bg-blue-600 text-white px-4 py-1.5 rounded text-sm hover:bg-blue-700">查询</button>
      <span id="statusText" class="text-sm text-gray-400"></span>
    </div>

    <!-- 概览卡片 -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4" id="summaryCards">
      <div class="card text-center">
        <div class="text-2xl font-bold text-blue-600" id="cardTotal">-</div>
        <div class="text-xs text-gray-500 mt-1">总监测条数</div>
      </div>
      <div class="card text-center">
        <div class="text-2xl font-bold text-green-600" id="cardMention">-</div>
        <div class="text-xs text-gray-500 mt-1">提及率</div>
      </div>
      <div class="card text-center">
        <div class="text-2xl font-bold text-yellow-600" id="cardRecommend">-</div>
        <div class="text-xs text-gray-500 mt-1">推荐率</div>
      </div>
      <div class="card text-center">
        <div class="text-2xl font-bold text-emerald-600" id="cardFirst">-</div>
        <div class="text-xs text-gray-500 mt-1">首位推荐率</div>
      </div>
    </div>

    <!-- 图表区 -->
    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div class="card">
        <h3 class="text-sm font-semibold text-gray-700 mb-3">各 AI 评分趋势</h3>
        <canvas id="providerChart" height="200"></canvas>
      </div>
      <div class="card">
        <h3 class="text-sm font-semibold text-gray-700 mb-3">评分分布</h3>
        <canvas id="scoreChart" height="200"></canvas>
      </div>
    </div>

    <!-- 数据表 -->
    <div class="card overflow-x-auto">
      <h3 class="text-sm font-semibold text-gray-700 mb-3">本周明细</h3>
      <table class="w-full text-sm">
        <thead>
          <tr class="border-b text-left text-gray-500">
            <th class="pb-2">AI</th>
            <th class="pb-2">问题</th>
            <th class="pb-2">品牌提及</th>
            <th class="pb-2">评分</th>
          </tr>
        </thead>
        <tbody id="detailTable"></tbody>
      </table>
    </div>
  </main>

  <script>
    // 默认本周
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    document.getElementById('weekPicker').value = monday.toISOString().slice(0, 10);

    async function loadData() {
      const week = document.getElementById('weekPicker').value;
      if (!week) return;

      document.getElementById('statusText').textContent = '加载中...';
      
      try {
        const res = await fetch('/api/v1/monitoring?week=' + week);
        const json = await res.json();
        
        renderSummary(json.data);
        renderTable(json.data);
        document.getElementById('statusText').textContent = '共 ' + json.total + ' 条 · 更新于 ' + new Date().toLocaleTimeString();
      } catch (e) {
        document.getElementById('statusText').textContent = '加载失败: ' + e.message;
      }
    }

    function renderSummary(data) {
      if (!data || data.length === 0) return;
      const total = data.length;
      const mentioned = data.filter(d => d.score >= 1).length;
      const recommended = data.filter(d => d.score >= 2).length;
      const first = data.filter(d => d.score === 3).length;

      document.getElementById('cardTotal').textContent = total;
      document.getElementById('cardMention').textContent = (mentioned / total * 100).toFixed(1) + '%';
      document.getElementById('cardRecommend').textContent = (recommended / total * 100).toFixed(1) + '%';
      document.getElementById('cardFirst').textContent = (first / total * 100).toFixed(1) + '%';
    }

    const providerNames = { doubao: '豆包', deepseek: 'DeepSeek', kimi: 'Kimi', tongyi: '通义', yuanbao: '元宝', wenxin: '文心' };
    const scoreNames = { 0: '未提及', 1: '仅提及', 2: '推荐', 3: '首位推荐' };

    function renderTable(data) {
      const tbody = document.getElementById('detailTable');
      tbody.innerHTML = data.map(d => \`
        <tr class="border-b hover:bg-gray-50">
          <td class="py-2">\${providerNames[d.ai_provider] || d.ai_provider}</td>
          <td class="py-2 max-w-xs truncate">\${d.question_snapshot}</td>
          <td class="py-2"><span class="px-2 py-0.5 rounded text-xs score-\${d.score}">\${scoreNames[d.score]}</span></td>
          <td class="py-2 font-mono">\${d.score}/3</td>
        </tr>
      \`).join('');
    }

    // 初始加载
    loadData();
  </script>
</body>
</html>`;
