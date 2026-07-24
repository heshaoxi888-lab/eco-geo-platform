// ECO GEO Workers API - 主入口
import { handleMonitoringWrite, handleMonitoringQuery, handleWeeklyReport } from './api/monitoring';
import { handleBrandsList, handleBrandsCreate } from './api/brands';
import { handleDashboard } from './api/dashboard';
import { authenticate, corsHeaders } from './middleware/auth';

export interface Env {
  DB: D1Database;
  ENVIRONMENT: string;
  API_SALT: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    // 健康检查（无需鉴权）
    if (path === '/health') {
      return Response.json({ status: 'ok', ts: Date.now() });
    }

    // 前端页面（无需鉴权）
    if (path === '/' || path === '/index.html') {
      return handleDashboard(env);
    }

    // 公开看板需要读取数据；写入与管理操作仍需 API Key。
    const isPublicRead =
      request.method === 'GET' &&
      (
        path === '/api/v1/monitoring' ||
        path === '/api/v1/monitoring/weekly' ||
        path === '/api/v1/brands'
      );

    const authResult = isPublicRead
      ? { ok: true, permission: 'read' }
      : await authenticate(request, env);

    if (!authResult.ok) {
      return Response.json({ error: authResult.error }, { status: 401, headers: corsHeaders() });
    }

    try {
      // ===== 鉴权检查（用于外部工作流接入自检） =====
      if (path === '/api/v1/auth/check' && request.method === 'GET') {
        return Response.json({
          ok: true,
          key_name: authResult.keyName,
          permission: authResult.permission
        }, { headers: corsHeaders() });
      }

      // ===== 监测数据 =====
      if (path === '/api/v1/monitoring' && request.method === 'POST') {
        if (authResult.permission !== 'write' && authResult.permission !== 'admin') {
          return Response.json({ error: 'forbidden' }, { status: 403 });
        }
        return handleMonitoringWrite(request, env);
      }

      if (path === '/api/v1/monitoring' && request.method === 'GET') {
        return handleMonitoringQuery(request, env);
      }

      // ===== 周报 =====
      if (path === '/api/v1/monitoring/weekly' && request.method === 'GET') {
        return handleWeeklyReport(request, env);
      }

      // ===== 品牌 =====
      if (path === '/api/v1/brands' && request.method === 'GET') {
        return handleBrandsList(env);
      }

      if (path === '/api/v1/brands' && request.method === 'POST') {
        if (authResult.permission !== 'admin') {
          return Response.json({ error: 'forbidden' }, { status: 403 });
        }
        return handleBrandsCreate(request, env);
      }

      return Response.json({ error: 'not found' }, { status: 404, headers: corsHeaders() });
    } catch (err: any) {
      console.error('Unhandled error:', err);
      return Response.json(
        { error: 'internal error', message: env.ENVIRONMENT === 'development' ? err.message : undefined },
        { status: 500, headers: corsHeaders() }
      );
    }
  }
};
