import type { Env } from '../index';
import {
  TEAM_WORKSPACE_ID,
  TeamApiError,
  assertTeamSameOrigin,
  cleanTeamDashboardState,
  listTeamMembers,
  normalizeTeamEmail,
  requireTeamMember,
  teamJsonError,
  teamRoleRank,
  validateTeamRole,
  writeTeamLog
} from '../middleware/team-auth';
import type { TeamRole } from '../middleware/team-auth';

type WorkspaceRow = {
  name: string;
  version: number;
  state_json: string | null;
  updated_at: number;
  updated_by: string | null;
};

export async function handleCollaboration(request: Request, env: Env): Promise<Response> {
  const path = new URL(request.url).pathname;
  try {
    if (path === '/api/bootstrap' && request.method === 'GET') return await handleBootstrap(request, env);
    if (path === '/api/state' && request.method === 'GET') return await handleStateGet(request, env);
    if (path === '/api/state' && request.method === 'PUT') return await handleStatePut(request, env);
    if (path === '/api/members') return await handleMembers(request, env);
    if (path === '/api/logs' && request.method === 'GET') return await handleLogs(request, env);
    return Response.json({ ok: false, error: 'not found' }, { status: 404 });
  } catch (error) {
    return teamJsonError(error);
  }
}

async function handleBootstrap(request: Request, env: Env): Promise<Response> {
  const member = await requireTeamMember(request, env);
  const workspace = await env.DB.prepare(`SELECT name, version, state_json, updated_at, updated_by
    FROM team_workspaces WHERE id = ?`).bind(TEAM_WORKSPACE_ID).first<WorkspaceRow>();
  return Response.json({
    ok: true,
    user: {
      id: member.id,
      email: member.email,
      name: member.name,
      role: member.role,
      status: member.status
    },
    workspace: {
      name: workspace?.name || 'ECO 内容运营团队',
      version: workspace?.version || 0,
      updatedAt: workspace?.updated_at || null,
      updatedBy: workspace?.updated_by || null
    },
    state: workspace?.state_json ? JSON.parse(workspace.state_json) : null,
    members: await listTeamMembers(env.DB)
  });
}

async function handleStateGet(request: Request, env: Env): Promise<Response> {
  await requireTeamMember(request, env);
  const row = await env.DB.prepare(`SELECT version, state_json, updated_at, updated_by
    FROM team_workspaces WHERE id = ?`).bind(TEAM_WORKSPACE_ID).first<WorkspaceRow>();
  return Response.json({
    ok: true,
    version: row?.version || 0,
    state: row?.state_json ? JSON.parse(row.state_json) : null,
    updatedAt: row?.updated_at || null,
    updatedBy: row?.updated_by || null
  });
}

async function handleStatePut(request: Request, env: Env): Promise<Response> {
  assertTeamSameOrigin(request);
  const member = await requireTeamMember(request, env, 'editor');
  const body = await request.json() as { state?: unknown; expectedVersion?: number; action?: string };
  if (!Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 0) {
    throw new TeamApiError(400, '缺少有效的数据版本号');
  }

  const current = await env.DB.prepare(`SELECT version, state_json, updated_at, updated_by
    FROM team_workspaces WHERE id = ?`).bind(TEAM_WORKSPACE_ID).first<WorkspaceRow>();
  const currentVersion = Number(current?.version || 0);
  if (currentVersion !== body.expectedVersion) {
    return Response.json({
      ok: false,
      conflict: true,
      version: currentVersion,
      state: current?.state_json ? JSON.parse(current.state_json) : null,
      updatedAt: current?.updated_at || null,
      updatedBy: current?.updated_by || null
    }, { status: 409 });
  }

  const stateJson = cleanTeamDashboardState(body.state);
  const now = Date.now();
  const result = await env.DB.prepare(`UPDATE team_workspaces
    SET version = version + 1, state_json = ?, updated_at = ?, updated_by = ?
    WHERE id = ? AND version = ?`)
    .bind(stateJson, now, member.email, TEAM_WORKSPACE_ID, currentVersion).run();
  if (!result.meta.changes) throw new TeamApiError(409, '数据已被其他成员更新，请重新同步');
  await writeTeamLog(env.DB, member.email, body.action || '同步工作流看板', 'workspace', `版本 ${currentVersion + 1}`);
  return Response.json({ ok: true, version: currentVersion + 1, updatedAt: now, updatedBy: member.email });
}

async function handleMembers(request: Request, env: Env): Promise<Response> {
  if (request.method === 'GET') {
    await requireTeamMember(request, env);
    return Response.json({ ok: true, members: await listTeamMembers(env.DB) });
  }

  assertTeamSameOrigin(request);
  const actor = await requireTeamMember(request, env, 'admin');

  if (request.method === 'POST') {
    const body = await request.json() as { email?: string; name?: string; role?: string };
    if (!body.email || !body.email.includes('@')) throw new TeamApiError(400, '请输入有效的成员邮箱');
    const email = normalizeTeamEmail(body.email);
    const name = String(body.name || email.split('@')[0]).trim().slice(0, 50);
    const role = validateTeamRole(body.role || 'editor');
    if (role === 'owner' && actor.role !== 'owner') throw new TeamApiError(403, '只有所有者可以添加其他所有者');
    if (teamRoleRank[role] > teamRoleRank[actor.role]) throw new TeamApiError(403, '不能授予高于自己的角色');

    const now = Date.now();
    const existing = await env.DB.prepare('SELECT id FROM team_members WHERE workspace_id = ? AND email = ?')
      .bind(TEAM_WORKSPACE_ID, email).first<{ id: string }>();
    const memberId = existing?.id || crypto.randomUUID();
    if (existing) {
      await env.DB.prepare(`UPDATE team_members SET name = ?, role = ?, status = 'active', updated_at = ? WHERE id = ?`)
        .bind(name, role, now, memberId).run();
    } else {
      await env.DB.prepare(`INSERT INTO team_members
        (id, workspace_id, email, name, role, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`)
        .bind(memberId, TEAM_WORKSPACE_ID, email, name, role, now, now).run();
    }

    await writeTeamLog(env.DB, actor.email, '添加团队成员', email, `${name} · ${role}`);
    return Response.json({ ok: true, members: await listTeamMembers(env.DB) });
  }

  if (request.method === 'PATCH') {
    const body = await request.json() as { id?: string; name?: string; role?: string; status?: string };
    if (!body.id) throw new TeamApiError(400, '缺少成员ID');
    const target = await env.DB.prepare('SELECT id, email, role FROM team_members WHERE id = ? AND workspace_id = ?')
      .bind(body.id, TEAM_WORKSPACE_ID).first<{ id: string; email: string; role: TeamRole }>();
    if (!target) throw new TeamApiError(404, '成员不存在');
    if (target.role === 'owner' && actor.role !== 'owner') throw new TeamApiError(403, '管理员不能修改所有者');
    const role = body.role ? validateTeamRole(body.role) : target.role;
    if (target.role === 'owner' && role !== 'owner') throw new TeamApiError(400, '所有者角色不能降级');
    if (teamRoleRank[role] > teamRoleRank[actor.role]) throw new TeamApiError(403, '不能授予高于自己的角色');
    const status = body.status === 'disabled' ? 'disabled' : 'active';
    if (target.email === actor.email && status === 'disabled') throw new TeamApiError(400, '不能停用自己的账号');
    const name = String(body.name || target.email.split('@')[0]).trim().slice(0, 50);
    await env.DB.prepare('UPDATE team_members SET name = ?, role = ?, status = ?, updated_at = ? WHERE id = ?')
      .bind(name, role, status, Date.now(), target.id).run();
    await writeTeamLog(env.DB, actor.email, '更新团队成员', target.email, `${role} · ${status}`);
    return Response.json({ ok: true, members: await listTeamMembers(env.DB) });
  }

  if (request.method === 'DELETE') {
    const id = new URL(request.url).searchParams.get('id');
    if (!id) throw new TeamApiError(400, '缺少成员ID');
    const target = await env.DB.prepare('SELECT id, email, role FROM team_members WHERE id = ? AND workspace_id = ?')
      .bind(id, TEAM_WORKSPACE_ID).first<{ id: string; email: string; role: TeamRole }>();
    if (!target) throw new TeamApiError(404, '成员不存在');
    if (target.role === 'owner') throw new TeamApiError(403, '所有者账号不能删除');
    if (target.email === actor.email) throw new TeamApiError(400, '不能删除自己的账号');
    await env.DB.batch([
      env.DB.prepare('DELETE FROM team_access_keys WHERE member_id = ?').bind(target.id),
      env.DB.prepare('DELETE FROM team_members WHERE id = ?').bind(target.id)
    ]);
    await writeTeamLog(env.DB, actor.email, '移除团队成员', target.email);
    return Response.json({ ok: true, members: await listTeamMembers(env.DB) });
  }

  throw new TeamApiError(405, 'method not allowed');
}

async function handleLogs(request: Request, env: Env): Promise<Response> {
  await requireTeamMember(request, env);
  const result = await env.DB.prepare(`SELECT actor_email, action, target, details, created_at
    FROM team_activity_logs WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 100`)
    .bind(TEAM_WORKSPACE_ID).all<{
      actor_email: string;
      action: string;
      target: string | null;
      details: string | null;
      created_at: number;
    }>();
  return Response.json({
    ok: true,
    logs: result.results.map(log => ({
      actorEmail: log.actor_email,
      action: log.action,
      target: log.target,
      details: log.details,
      createdAt: log.created_at
    }))
  });
}
