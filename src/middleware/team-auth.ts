import type { Env } from '../index';

export type TeamRole = 'owner' | 'admin' | 'editor' | 'viewer';

export interface TeamMember {
  id: string;
  workspace_id: string;
  email: string;
  name: string;
  role: TeamRole;
  status: 'active' | 'disabled';
  created_at: number;
  updated_at: number;
  last_seen_at: number | null;
}

export class TeamApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const TEAM_WORKSPACE_ID = 'eco-main';
export const teamRoleRank: Record<TeamRole, number> = {
  viewer: 0,
  editor: 1,
  admin: 2,
  owner: 3
};

let collaborationSchemaReady: Promise<void> | null = null;

export async function ensureCollaborationSchema(db: D1Database): Promise<void> {
  if (!collaborationSchemaReady) {
    collaborationSchemaReady = initializeCollaborationSchema(db).catch(error => {
      collaborationSchemaReady = null;
      throw error;
    });
  }
  return collaborationSchemaReady;
}

async function initializeCollaborationSchema(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS team_workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 0,
      state_json TEXT,
      updated_at INTEGER NOT NULL,
      updated_by TEXT
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS team_members (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      email TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('owner','admin','editor','viewer')),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_seen_at INTEGER
    )`),
    db.prepare('CREATE UNIQUE INDEX IF NOT EXISTS team_members_workspace_email_idx ON team_members(workspace_id, email)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS team_access_keys (
      id TEXT PRIMARY KEY,
      member_id TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER,
      FOREIGN KEY(member_id) REFERENCES team_members(id)
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS team_access_keys_member_idx ON team_access_keys(member_id)'),
    db.prepare(`CREATE TABLE IF NOT EXISTS team_activity_logs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      actor_email TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT,
      details TEXT,
      created_at INTEGER NOT NULL
    )`),
    db.prepare('CREATE INDEX IF NOT EXISTS team_activity_logs_workspace_created_idx ON team_activity_logs(workspace_id, created_at DESC)')
  ]);

  await db.prepare(
    'INSERT OR IGNORE INTO team_workspaces (id, name, version, state_json, updated_at) VALUES (?, ?, 0, NULL, ?)'
  ).bind(TEAM_WORKSPACE_ID, 'ECO 内容运营团队', Date.now()).run();
}

export async function requireTeamMember(
  request: Request,
  env: Env,
  minimum: TeamRole = 'viewer'
): Promise<TeamMember> {
  await ensureCollaborationSchema(env.DB);
  const rawKey = request.headers.get('X-Team-Key')?.trim();
  if (!rawKey) throw new TeamApiError(401, '请输入团队访问密钥');

  const keyHash = await hashTeamKey(rawKey);
  const member = await env.DB.prepare(`SELECT m.* FROM team_access_keys k
    JOIN team_members m ON m.id = k.member_id
    WHERE k.key_hash = ? AND k.is_active = 1 AND m.workspace_id = ?`)
    .bind(keyHash, TEAM_WORKSPACE_ID)
    .first<TeamMember>();

  if (!member || member.status !== 'active') {
    throw new TeamApiError(403, '团队访问密钥无效或账号已停用');
  }
  if (teamRoleRank[member.role] < teamRoleRank[minimum]) {
    throw new TeamApiError(403, '当前账号没有执行此操作的权限');
  }

  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('UPDATE team_access_keys SET last_used_at = ? WHERE key_hash = ?').bind(now, keyHash),
    env.DB.prepare('UPDATE team_members SET last_seen_at = ? WHERE id = ?').bind(now, member.id)
  ]);
  member.last_seen_at = now;
  return member;
}

export async function listTeamMembers(db: D1Database): Promise<Array<Record<string, unknown>>> {
  const result = await db.prepare(`SELECT id, email, name, role, status, created_at, updated_at, last_seen_at
    FROM team_members WHERE workspace_id = ?
    ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'editor' THEN 2 ELSE 3 END, created_at`)
    .bind(TEAM_WORKSPACE_ID).all<TeamMember>();
  return result.results.map(member => ({
    id: member.id,
    email: member.email,
    name: member.name,
    role: member.role,
    status: member.status,
    createdAt: member.created_at,
    updatedAt: member.updated_at,
    lastSeenAt: member.last_seen_at
  }));
}

export function normalizeTeamEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function validateTeamRole(value: unknown): TeamRole {
  if (value === 'owner' || value === 'admin' || value === 'editor' || value === 'viewer') return value;
  throw new TeamApiError(400, '无效的成员角色');
}

export function assertTeamSameOrigin(request: Request): void {
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) {
    throw new TeamApiError(403, '跨站请求已被拒绝');
  }
}

export function cleanTeamDashboardState(input: unknown): string {
  if (!input || typeof input !== 'object') throw new TeamApiError(400, '看板数据格式无效');
  const state = structuredClone(input) as Record<string, any>;
  state.config ||= {};
  state.config.collab = { enabled: true, provider: 'cloudflare-d1', interval: 10000 };
  if (state.config.ai) {
    state.config.ai = {
      provider: state.config.ai.provider || 'coze',
      cozeBotId: state.config.ai.cozeBotId || '',
      doubaoModel: state.config.ai.doubaoModel || 'doubao-seed-1-6-flash',
      deepseekModel: state.config.ai.deepseekModel || 'deepseek-chat'
    };
  }
  const json = JSON.stringify(state);
  if (new TextEncoder().encode(json).byteLength > 1_500_000) {
    throw new TeamApiError(413, '看板数据超过当前版本的1.5MB限制');
  }
  return json;
}

export async function writeTeamLog(
  db: D1Database,
  actorEmail: string,
  action: string,
  target?: string,
  details?: string
): Promise<void> {
  await db.prepare(`INSERT INTO team_activity_logs
    (id, workspace_id, actor_email, action, target, details, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), TEAM_WORKSPACE_ID, actorEmail, action, target || null, details || null, Date.now())
    .run();
}

export function teamJsonError(error: unknown): Response {
  if (error instanceof TeamApiError) {
    return Response.json({ ok: false, error: error.message }, { status: error.status });
  }
  console.error('Team API error:', error);
  return Response.json({ ok: false, error: '服务器处理失败' }, { status: 500 });
}

export function createTeamAccessKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `eco_team_${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

export async function hashTeamKey(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
