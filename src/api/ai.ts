import type { Env } from '../index';
import {
  assertTeamSameOrigin,
  requireTeamMember,
  teamJsonError,
  type TeamMember
} from '../middleware/team-auth';

const COZE_CHAT_ENDPOINT = 'https://api.coze.cn/open_api/v2/chat';
const MAX_PROMPT_LENGTH = 30_000;

type CozeMessage = {
  type?: string;
  content?: string;
};

type CozeResponse = {
  code?: number;
  msg?: string;
  messages?: CozeMessage[];
};

function isConfigured(env: Env): boolean {
  return Boolean(env.COZE_PAT?.trim() && env.COZE_BOT_ID?.trim());
}

function cozeUserId(member: TeamMember): string {
  return `eco_dashboard_${member.id.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32)}`;
}

function readPromptPart(value: unknown, field: string): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (trimmed.length > MAX_PROMPT_LENGTH) {
    throw new Error(`${field}内容过长，请缩短后重试`);
  }
  return trimmed;
}

async function parseUpstreamBody(response: Response): Promise<CozeResponse> {
  try {
    return await response.json() as CozeResponse;
  } catch {
    return {};
  }
}

export async function handleAI(request: Request, env: Env): Promise<Response> {
  try {
    const member = await requireTeamMember(request, env, 'viewer');
    const url = new URL(request.url);

    if (url.pathname === '/api/ai/status' && request.method === 'GET') {
      return Response.json({
        ok: true,
        provider: 'coze',
        configured: isConfigured(env),
        managedBy: 'cloudflare-worker-secret'
      });
    }

    if (url.pathname !== '/api/ai/chat' || request.method !== 'POST') {
      return Response.json({ ok: false, error: 'not found' }, { status: 404 });
    }

    assertTeamSameOrigin(request);
    if (!isConfigured(env)) {
      return Response.json(
        { ok: false, error: '扣子服务尚未在 Cloudflare Worker 中配置' },
        { status: 503 }
      );
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json() as Record<string, unknown>;
    } catch {
      return Response.json({ ok: false, error: '请求内容不是有效 JSON' }, { status: 400 });
    }

    let systemPrompt: string;
    let userPrompt: string;
    try {
      systemPrompt = readPromptPart(body.systemPrompt, '系统提示');
      userPrompt = readPromptPart(body.userPrompt, '用户提示');
    } catch (error) {
      return Response.json(
        { ok: false, error: error instanceof Error ? error.message : '提示内容无效' },
        { status: 400 }
      );
    }
    if (!userPrompt) {
      return Response.json({ ok: false, error: '用户提示不能为空' }, { status: 400 });
    }

    const query = systemPrompt ? `${systemPrompt}\n\n${userPrompt}` : userPrompt;
    let upstream: Response;
    try {
      upstream = await fetch(COZE_CHAT_ENDPOINT, {
        method: 'POST',
        signal: request.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.COZE_PAT.trim()}`
        },
        body: JSON.stringify({
          bot_id: env.COZE_BOT_ID.trim(),
          user: cozeUserId(member),
          query,
          stream: false
        })
      });
    } catch {
      return Response.json({ ok: false, error: '暂时无法连接扣子服务' }, { status: 502 });
    }

    const data = await parseUpstreamBody(upstream);
    if (!upstream.ok || (typeof data.code === 'number' && data.code !== 0)) {
      console.error('Coze API error', { status: upstream.status, code: data.code, message: data.msg });
      const message = upstream.status === 401
        ? '扣子服务凭据已失效，请管理员更新 Cloudflare Worker Secret'
        : upstream.status === 404
          ? '扣子 Bot 不存在、未发布或当前凭据无权访问'
          : data.msg || `扣子服务请求失败（${upstream.status || 502}）`;
      return Response.json({ ok: false, error: message }, { status: 502 });
    }

    const answers = Array.isArray(data.messages)
      ? data.messages.filter(message => message.type === 'answer' && typeof message.content === 'string')
      : [];
    const answer = answers.at(-1)?.content?.trim();
    if (!answer) {
      return Response.json({ ok: false, error: '扣子服务返回内容为空' }, { status: 502 });
    }

    return Response.json({ ok: true, answer });
  } catch (error) {
    return teamJsonError(error);
  }
}
