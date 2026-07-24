// 监测数据 API
import type { Env } from '../index';
import { corsHeaders } from '../middleware/auth';

// POST /api/v1/monitoring - 写入监测数据
export async function handleMonitoringWrite(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as any;
  
  // 参数校验
  const required = ['week_start_date', 'ai_provider', 'question_id', 'question_snapshot', 'score'];
  for (const field of required) {
    if (body[field] === undefined || body[field] === null) {
      return Response.json({ error: `missing field: ${field}` }, { status: 400, headers: corsHeaders() });
    }
  }

  if (body.score < 0 || body.score > 3) {
    return Response.json({ error: 'score must be 0-3' }, { status: 400, headers: corsHeaders() });
  }

  const validProviders = ['doubao', 'deepseek', 'kimi', 'tongyi', 'yuanbao', 'wenxin'];
  if (!validProviders.includes(body.ai_provider)) {
    return Response.json({ error: `invalid provider, must be one of: ${validProviders.join(', ')}` }, { status: 400, headers: corsHeaders() });
  }

  // 写入数据
  const stmt = env.DB.prepare(`
    INSERT INTO geo_monitoring (week_start_date, ai_provider, question_id, brand_id, question_snapshot, brand_mentioned, score, response_summary, raw_response)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(week_start_date, ai_provider, question_id) DO UPDATE SET
      score = excluded.score,
      brand_mentioned = excluded.brand_mentioned,
      response_summary = excluded.response_summary,
      raw_response = excluded.raw_response
  `);

  const result = await stmt.bind(
    body.week_start_date,
    body.ai_provider,
    body.question_id,
    body.brand_id || null,
    body.question_snapshot,
    body.brand_mentioned || 0,
    body.score,
    body.response_summary || null,
    body.raw_response || null
  ).run();

  return Response.json({
    success: true,
    id: result.meta?.last_row_id,
    changes: result.meta?.changes
  }, { headers: corsHeaders() });
}

// GET /api/v1/monitoring - 查询监测数据
export async function handleMonitoringQuery(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const week = url.searchParams.get('week');
  const provider = url.searchParams.get('provider');
  const brandId = url.searchParams.get('brand_id');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 1000);
  const offset = parseInt(url.searchParams.get('offset') || '0');

  let sql = `SELECT m.*, b.name as brand_name FROM geo_monitoring m LEFT JOIN brands b ON m.brand_id = b.id WHERE 1=1`;
  const params: any[] = [];

  if (week) {
    sql += ` AND m.week_start_date = ?`;
    params.push(week);
  }
  if (provider) {
    sql += ` AND m.ai_provider = ?`;
    params.push(provider);
  }
  if (brandId) {
    sql += ` AND m.brand_id = ?`;
    params.push(parseInt(brandId));
  }

  sql += ` ORDER BY m.week_start_date DESC, m.ai_provider, m.question_id LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const stmt = env.DB.prepare(sql);
  const result = await stmt.bind(...params).all();

  // 统计总数
  let countSql = `SELECT COUNT(*) as total FROM geo_monitoring m WHERE 1=1`;
  const countParams: any[] = [];
  if (week) { countSql += ` AND m.week_start_date = ?`; countParams.push(week); }
  if (provider) { countSql += ` AND m.ai_provider = ?`; countParams.push(provider); }
  if (brandId) { countSql += ` AND m.brand_id = ?`; countParams.push(parseInt(brandId)); }

  const countResult = await env.DB.prepare(countSql).bind(...countParams).first();

  return Response.json({
    data: result.results,
    total: countResult?.total || 0,
    limit,
    offset
  }, { headers: corsHeaders() });
}

// GET /api/v1/monitoring/weekly - 周报汇总
export async function handleWeeklyReport(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const week = url.searchParams.get('week');
  const brandId = url.searchParams.get('brand_id');

  if (!week) {
    return Response.json({ error: 'missing week parameter (format: YYYY-MM-DD)' }, { status: 400, headers: corsHeaders() });
  }

  let sql = `SELECT * FROM weekly_reports WHERE week_start_date = ?`;
  const params: any[] = [week];

  if (brandId) {
    sql += ` AND brand_id = ?`;
    params.push(parseInt(brandId));
  }

  const result = await env.DB.prepare(sql).bind(...params).all();

  return Response.json({
    data: result.results,
    week
  }, { headers: corsHeaders() });
}
