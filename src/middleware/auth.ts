// 鉴权中间件
import type { Env } from '../index';

export interface AuthResult {
  ok: boolean;
  error?: string;
  keyName?: string;
  permission?: string;
}

export async function authenticate(request: Request, env: Env): Promise<AuthResult> {
  const apiKey = request.headers.get('X-API-Key');
  if (!apiKey) {
    return { ok: false, error: 'missing api key' };
  }

  // 简单实现：对比哈希值
  const hash = await sha256(apiKey + env.API_SALT);
  
  const key = await env.DB.prepare(
    'SELECT name, permission FROM api_keys WHERE key_hash = ? AND is_active = 1'
  ).bind(hash).first();

  if (!key) {
    return { ok: false, error: 'invalid api key' };
  }

  // 更新最后使用时间
  env.DB.prepare(
    'UPDATE api_keys SET last_used_at = datetime("now") WHERE key_hash = ?'
  ).bind(hash).run().catch(() => {});

  return {
    ok: true,
    keyName: key.name as string,
    permission: key.permission as string
  };
}

export function corsHeaders(): Headers {
  return new Headers({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, X-Team-Key',
    'Access-Control-Max-Age': '86400'
  });
}

async function sha256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
