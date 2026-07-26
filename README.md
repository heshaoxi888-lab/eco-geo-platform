# ECO GEO 品牌 AI 监测平台

> ECO 内容生产多人协作看板 + 6 家 AI 助手 GEO 推荐监测，统一替代原 localStorage/jsonbin 生产方案

## 技术栈

- **API**: Cloudflare Workers (TypeScript)
- **数据库**: Cloudflare D1 (SQLite)
- **前端**: 完整 ECO 工作流单页看板
- **数据采集**: 扣子 Bot 定时工单 → Workers API
- **多人协作**: Cloudflare Access 邮箱登录、D1 团队状态、角色权限、操作日志

## 架构

```
扣子 Bot (定时工单)
  ├─ 调用 6 家 AI (豆包/DeepSeek/Kimi/通义/元宝/文心)
  ├─ AI 语义评分 (0-3)
  └─ POST /api/v1/monitoring → Cloudflare Workers
                                   ├─ API Key 鉴权
                                   ├─ 数据校验
                                   └─ D1 写入

浏览器看板
  ├─ Cloudflare Access 邮箱认证
  ├─ 工作流状态 /api/state → Workers → D1
  ├─ 内容生成 /api/ai/chat → Workers → 扣子 Bot
  └─ GEO 监测 /api/v1/monitoring → Workers → D1
```

正式生产地址：<https://ecogeo.ccwu.cc/>

`workers.dev` 地址保留用于健康检查、扣子 API 和应急团队密钥访问；团队成员日常只使用自定义域名。

GitHub 是唯一源码与版本协作入口；Cloudflare Worker + D1 是唯一生产运行环境。GitHub Pages/Deployments 不作为本项目的正式发布地址。

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 创建 D1 数据库

```bash
npx wrangler login
npx wrangler d1 create eco-geo-db
```

将返回的 `database_id` 填入 `wrangler.toml`。

### 3. 初始化表结构

```bash
npm run db:migrate
```

### 4. 设置 API Salt

```bash
npx wrangler secret put API_SALT
# 输入一个随机字符串
```

### 5. 本地开发

```bash
npm run db:migrate:local   # 初始化本地数据库
npm run dev                 # http://localhost:8787
```

### 6. 部署

```bash
npm run deploy
```

### 扣子 Bot 自动连接

扣子 PAT 只保存在 Cloudflare Worker Secret 中，不写入 Git、D1、网页源码或浏览器本地存储。Bot ID 配置在 `wrangler.toml` 的 `COZE_BOT_ID`；团队成员通过 Cloudflare Access 登录后会自动使用统一 Bot，无需各自填写。

首次配置或轮换 PAT：

```bash
npx wrangler secret put COZE_PAT
```

状态检查使用 `GET /api/ai/status`，真实生成使用 `POST /api/ai/chat`。这两个接口均校验 Cloudflare Access 身份和 D1 成员状态。

## API 文档

### POST /api/v1/monitoring

写入监测数据（需要 write/admin 权限）

```json
{
  "week_start_date": "2026-07-21",
  "ai_provider": "doubao",
  "question_id": 1,
  "question_snapshot": "推荐一款有机洗发水",
  "brand_id": 1,
  "brand_mentioned": 2,
  "score": 2,
  "response_summary": "推荐了 ECO 有机洗发水，提到成分天然..."
}
```

### GET /api/v1/monitoring

查询监测数据（支持 week/provider/brand_id/limit/offset）

### GET /api/v1/monitoring/weekly?week=2026-07-21

获取周报汇总

### GET /api/v1/brands

品牌列表

### GET /api/v1/auth/check

验证 API Key 是否有效并返回密钥名称与权限（需要 API Key）。

## API 鉴权

公开看板所需的只读接口（`GET /api/v1/monitoring`、`GET /api/v1/monitoring/weekly`、`GET /api/v1/brands`）无需 API Key。

写入及管理请求需要在 Header 中传入 API Key：

```
X-API-Key: your-api-key-here
```

权限级别：
- `read`: 仅查询
- `write`: 查询 + 写入监测数据
- `admin`: 全部权限（含品牌管理）

多人协作接口（`/api/bootstrap`、`/api/state`、`/api/members`、`/api/logs`）验证 Cloudflare Access JWT，并按登录邮箱读取 D1 成员角色。生产环境需要在 `wrangler.toml` 配置：

```
TEAM_DOMAIN=https://parrotfly.cloudflareaccess.com
POLICY_AUD=Cloudflare Access Application Audience
```

成员由所有者或管理员在看板的“账号&协作”页面添加。成员使用被添加的邮箱通过 Cloudflare Access 验证码登录，无需团队密钥。旧成员密钥仅保留为 `workers.dev` 故障恢复入口，D1 仍只保存其 SHA-256 哈希。

## 评分标准

| 分数 | 含义 | 说明 |
|------|------|------|
| 0 | 未提及 | AI 回答中未出现品牌名 |
| 1 | 仅提及 | 提到品牌但未推荐 |
| 2 | 推荐 | 明确推荐该品牌 |
| 3 | 首位推荐 | 作为首选/第一推荐 |

## License

Private - ECO Team


## 自动部署

`main` 分支的新提交会由 Cloudflare Workers Builds 自动构建并部署到正式生产地址。日常发布流程为：提交代码 → 推送 GitHub `main` → Cloudflare 自动构建 → 线上验收。
