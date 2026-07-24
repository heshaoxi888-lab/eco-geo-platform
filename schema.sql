-- ECO GEO 品牌监测数据库 Schema
-- Cloudflare D1

-- 品牌表
CREATE TABLE IF NOT EXISTS brands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL DEFAULT '洗护',
  keywords TEXT,           -- JSON array: ["ECO", "有机洗发水"]
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 问题库表
CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,   -- '洗发水推荐', '品牌对比', '成分咨询' 等
  question_text TEXT NOT NULL,
  difficulty TEXT NOT NULL DEFAULT 'medium',  -- easy/medium/hard
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- GEO 监测主表
CREATE TABLE IF NOT EXISTS geo_monitoring (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week_start_date TEXT NOT NULL,          -- 周一日期 YYYY-MM-DD
  ai_provider TEXT NOT NULL,              -- doubao/deepseek/kimi/tongyi/yuanbao/wenxin
  question_id INTEGER NOT NULL,
  brand_id INTEGER,
  question_snapshot TEXT NOT NULL,        -- 冗余存储，防止问题变更
  brand_mentioned INTEGER NOT NULL DEFAULT 0,  -- 0=未提及, 1=仅提及, 2=推荐, 3=首位推荐
  score INTEGER NOT NULL DEFAULT 0,       -- 0-3 评分
  response_summary TEXT,                  -- AI 回答摘要
  raw_response TEXT,                      -- 原始回答（可选）
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (question_id) REFERENCES questions(id),
  FOREIGN KEY (brand_id) REFERENCES brands(id),
  UNIQUE(week_start_date, ai_provider, question_id)
);

-- 周报汇总表
CREATE TABLE IF NOT EXISTS weekly_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  week_start_date TEXT NOT NULL,
  brand_id INTEGER,
  total_questions INTEGER NOT NULL DEFAULT 0,
  avg_score REAL NOT NULL DEFAULT 0,
  mention_rate REAL NOT NULL DEFAULT 0,     -- 提及率 0-1
  recommend_rate REAL NOT NULL DEFAULT 0,   -- 推荐率 0-1
  first_position_rate REAL NOT NULL DEFAULT 0, -- 首位率 0-1
  score_distribution TEXT,                   -- JSON: {"0": 10, "1": 5, "2": 3, "3": 2}
  provider_breakdown TEXT,                   -- JSON: {"doubao": 2.1, "deepseek": 1.8, ...}
  highlights TEXT,                           -- 本周亮点
  risks TEXT,                               -- 风险预警
  report_text TEXT,                          -- 完整周报文本
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (brand_id) REFERENCES brands(id),
  UNIQUE(week_start_date, brand_id)
);

-- API 密钥表（用于 Workers API 鉴权）
CREATE TABLE IF NOT EXISTS api_keys (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,              -- 用途描述: "coze-bot", "dashboard-readonly"
  permission TEXT NOT NULL DEFAULT 'read',  -- read/write/admin
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_monitoring_week ON geo_monitoring(week_start_date);
CREATE INDEX IF NOT EXISTS idx_monitoring_brand ON geo_monitoring(brand_id);
CREATE INDEX IF NOT EXISTS idx_monitoring_score ON geo_monitoring(score);
CREATE INDEX IF NOT EXISTS idx_monitoring_provider ON geo_monitoring(ai_provider);
CREATE INDEX IF NOT EXISTS idx_weekly_report_week ON weekly_reports(week_start_date);

-- 完整工作流看板：团队工作空间
CREATE TABLE IF NOT EXISTS team_workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  state_json TEXT,
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);

-- 完整工作流看板：团队成员与角色
CREATE TABLE IF NOT EXISTS team_members (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner','admin','editor','viewer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_seen_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS team_members_workspace_email_idx
  ON team_members(workspace_id, email);

-- 每位团队成员独立访问密钥；仅保存 SHA-256 哈希
CREATE TABLE IF NOT EXISTS team_access_keys (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  FOREIGN KEY(member_id) REFERENCES team_members(id)
);

CREATE INDEX IF NOT EXISTS team_access_keys_member_idx ON team_access_keys(member_id);

-- 团队操作日志
CREATE TABLE IF NOT EXISTS team_activity_logs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  details TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS team_activity_logs_workspace_created_idx
  ON team_activity_logs(workspace_id, created_at DESC);

INSERT OR IGNORE INTO team_workspaces (id, name, version, state_json, updated_at)
VALUES ('eco-main', 'ECO 内容运营团队', 0, NULL, unixepoch('now') * 1000);
