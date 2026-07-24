// 品牌管理 API
import type { Env } from '../index';
import { corsHeaders } from '../middleware/auth';

// GET /api/v1/brands - 品牌列表
export async function handleBrandsList(env: Env): Promise<Response> {
  const result = await env.DB.prepare(
    'SELECT * FROM brands WHERE is_active = 1 ORDER BY name'
  ).all();

  return Response.json({ data: result.results }, { headers: corsHeaders() });
}

// POST /api/v1/brands - 新增品牌
export async function handleBrandsCreate(request: Request, env: Env): Promise<Response> {
  const body = await request.json() as any;

  if (!body.name) {
    return Response.json({ error: 'missing name' }, { status: 400, headers: corsHeaders() });
  }

  const result = await env.DB.prepare(
    'INSERT INTO brands (name, category, keywords) VALUES (?, ?, ?)'
  ).bind(
    body.name,
    body.category || '洗护',
    JSON.stringify(body.keywords || [])
  ).run();

  return Response.json({
    success: true,
    id: result.meta?.last_row_id
  }, { status: 201, headers: corsHeaders() });
}
