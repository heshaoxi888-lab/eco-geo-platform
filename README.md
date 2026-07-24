# ECO GEO 品牌 AI 监测平台

> 追踪 ECO 品牌在 6 家 AI 助手中的推荐表现，替代原 jsonbin 方案

## 技术栈

- **API**: Cloudflare Workers (TypeScript)
- **数据库**: Cloudflare D1 (SQLite)
- **前端**: 单页 HTML + Tailwind + Chart.js
- **数据采集**: 扣子 Bot 定时工单 → Workers API

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
  └─ GET /api/v1/monitoring → Workers → D1 → JSON
```

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

`main` 分支的新提交会由 Cloudflare Workers Builds 自动构建并部署。
