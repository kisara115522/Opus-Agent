# SuperBiz Agent (TypeScript)

企业级智能运维 Agent 系统 - 从 Java 迁移至 TypeScript。

## 功能特性

### RAG 智能问答
- 基于向量检索（Milvus）的智能问答
- 多 LLM 提供商支持（OpenAI、Anthropic、DashScope）
- 会话管理 + 滑动窗口历史
- SSE 流式响应

### 发布预检
- 10 因子加权风险评分引擎
- 多 Agent 模式（Planner/Executor/Reporter）
- 文件持久化历史记录和权重审计日志
- 生成结构化 Markdown 报告

### 代码审查
- 6 步流水线：校验 -> 收集 Git -> 评估风险 -> RAG 证据 -> Agent 审查 -> 生成报告
- 12 条规则化风险检查（敏感信息、缺失测试、配置变更等）
- 多 Agent 深度审查（Planner/Reviewer/Judge）
- SSE 流式进度推送

### AIOps 智能告警分析
- 基于 AI Agent 循环的自动告警诊断
- 自动获取活跃告警并关联指标/日志
- 生成根因分析和修复建议
- SSE 流式实时进度推送

### 文件上传
- 多部分文件上传 + 扩展名校验
- 自动向量化，构建 RAG 知识库

## 架构设计

```
┌─────────────────────────────────────────────────────┐
│                    Hono HTTP 服务器                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐ ┌────────┐ │
│  │chat.ts   │ │release.ts│ │review.ts │ │upload.ts│ │ai-ops.ts│ │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └───┬────┘ └───┬────┘ │
│       │             │            │            │      │
│  ┌────▼─────────────▼────────────▼────────────▼───┐  │
│  │                 服务层                          │  │
│  │  chat / rag / risk-scoring / release-precheck / │  │
│  │  code-review / ai-ops / vector-*                │  │
│  └────┬─────────────┬────────────┬────────────────┘  │
│       │             │            │                    │
│  ┌────▼─────┐ ┌─────▼──────┐ ┌──▼──────────────┐    │
│  │ Provider │ │   Agent    │ │    Tools        │    │
│  │ (多提供商) │ │ react-agent│ │ datetime/docs/  │    │
│  │          │ │ + guards   │ │ metrics/logs    │    │
│  └──────────┘ └────────────┘ └─────────────────┘    │
└─────────────────────────────────────────────────────┘
         │              │              │
    ┌────▼────┐   ┌─────▼────┐  ┌─────▼─────┐
    │ Milvus  │   │ LLM APIs │  │ Prometheus│
    │ (向量DB) │   │ (多提供商) │  │  (监控)   │
    └─────────┘   └──────────┘  └───────────┘
```

## 技术栈

| 组件 | 技术 |
|------|------|
| 运行时 | Node.js 20+ |
| 语言 | TypeScript 5.4+ |
| Web 框架 | Hono |
| Agent 框架 | Vercel AI SDK |
| LLM 提供商 | OpenAI、Anthropic、DashScope |
| 向量数据库 | Milvus (@zilliz/milvus2-sdk-node) |
| 数据校验 | Zod |
| 日志 | Pino |
| 测试 | Vitest |

## 快速开始

```bash
# 安装依赖
npm install

# 交互式配置（推荐）
npm run setup

# 或手动复制配置
cp .env.example .env

# 启动 Milvus（可选，知识库功能需要）
docker compose up -d

# 开发模式
make dev

# 或直接运行
npx tsx --watch src/index.ts
```

## 项目结构

```
src/
├── index.ts                          # 入口文件（启动 + 服务）
├── config/
│   ├── index.ts                      # Zod 校验配置单例
│   └── stub.ts                       # 测试用 Stub 配置
├── server/
│   ├── app.ts                        # Hono 应用工厂
│   └── middleware/                    # CORS、错误处理、静态文件
├── routes/
│   ├── chat.ts                       # Chat API（4 个端点）
│   ├── release.ts                    # 发布预检（8 个端点）
│   ├── review.ts                     # 代码审查（8 个端点）
│   ├── ai-ops.ts                     # AIOps 智能告警分析
│   ├── upload.ts                     # 文件上传
│   └── health.ts                     # 健康检查
├── services/
│   ├── chat.service.ts               # Chat + 会话管理
│   ├── rag.service.ts                # RAG（向量检索 + LLM）
│   ├── risk-scoring.service.ts       # 10 因子风险评分
│   ├── release-precheck.service.ts   # 发布预检编排
│   ├── release-precheck-agent.service.ts  # 多 Agent（Planner/Executor/Reporter）
│   ├── release-report.service.ts     # 报告生成
│   ├── precheck-history.service.ts   # 文件持久化历史
│   ├── precheck-weight-audit.service.ts   # 权重审计日志
│   ├── code-review.service.ts        # 代码审查流水线
│   ├── code-review-agent.service.ts  # 多 Agent（Planner/Reviewer/Judge）
│   ├── code-review-report.service.ts # 报告生成
│   ├── review-history.service.ts     # 文件持久化历史
│   ├── document-chunk.service.ts     # Markdown 感知分片
│   ├── vector-embedding.service.ts   # Embedding 封装
│   ├── vector-index.service.ts       # 文件 -> 分片 -> 嵌入 -> Milvus
│   └── vector-search.service.ts      # 查询 -> 嵌入 -> Milvus 搜索
├── agents/
│   ├── react-agent.ts                # ReAct Agent + 防护
│   └── guards/                       # 熔断器、调用限制
├── providers/
│   ├── openai.provider.ts            # OpenAI（LLM + Embedding）
│   ├── anthropic.provider.ts         # Anthropic（仅 LLM）
│   └── dashscope.provider.ts         # DashScope（LLM + Embedding）
├── tools/
│   ├── datetime.tool.ts              # 当前日期/时间
│   ├── internal-docs.tool.ts         # RAG 向量检索
│   ├── query-metrics.tool.ts         # Prometheus 告警
│   └── query-logs.tool.ts            # 云日志
├── types/                            # TypeScript 接口定义
├── utils/                            # Git、文件、文本工具
├── clients/                          # Milvus + Embedding 客户端
├── constants/                        # Milvus 常量
├── skills/                           # Skills 系统（可扩展）
├── channels/                         # 聊天 Channel（可扩展）
└── events/                           # 事件总线（可扩展）
```

## API 端点

### Chat 智能问答
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/chat` | 同步对话 |
| POST | `/api/chat_stream` | SSE 流式对话 |
| POST | `/api/chat/clear` | 清除会话历史 |
| GET | `/api/chat/session/:id` | 获取会话信息 |

### 发布预检
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/release/precheck` | 同步预检 |
| POST | `/api/release/precheck/stream` | SSE 流式预检 |
| GET | `/api/release/precheck/:id` | 获取预检结果 |
| GET | `/api/release/precheck` | 获取最新结果列表 |
| GET | `/api/release/precheck/config` | 获取配置 |
| POST | `/api/release/precheck/feedback` | 提交反馈 |
| POST | `/api/release/weights` | 更新评分权重 |
| GET | `/api/release/weights/audit` | 权重审计日志 |

### 代码审查
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/code-review/analyze` | 同步审查 |
| POST | `/api/code-review/analyze/stream` | SSE 流式审查 |
| GET | `/api/code-review/:id` | 获取审查结果 |
| GET | `/api/code-review` | 获取最新审查列表 |
| GET | `/api/code-review/config` | 获取配置 |
| POST | `/api/code-review/feedback` | 提交反馈 |
| GET | `/api/code-review/export/:id` | 导出 Markdown |
| GET | `/api/code-review/health` | 健康检查 |

### AIOps 智能告警分析
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/ai_ops` | SSE 流式自动分析 |

### 文件上传
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/upload` | 上传文件 + 向量化 |

### 健康检查
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/milvus/health` | Milvus 健康检查 |

## 配置说明

所有配置通过环境变量或 `.env` 文件设置。完整列表见 `.env.example`。

### 核心配置
| 变量 | 默认值 | 说明 |
|------|--------|------|
| `PORT` | 9900 | 服务端口 |
| `LLM_PROVIDER` | openai | LLM 提供商（openai/anthropic/dashscope） |
| `LLM_MODEL` | gpt-4o | LLM 模型名称 |
| `OPENAI_API_KEY` | - | OpenAI API Key |
| `ANTHROPIC_API_KEY` | - | Anthropic API Key |
| `DASHSCOPE_API_KEY` | - | DashScope API Key |
| `EMBEDDING_PROVIDER` | openai | Embedding 提供商 |
| `EMBEDDING_MODEL` | text-embedding-3-small | Embedding 模型 |

### Milvus 配置
| 变量 | 默认值 | 说明 |
|------|--------|------|
| `MILVUS_HOST` | localhost | Milvus 主机 |
| `MILVUS_PORT` | 19530 | Milvus 端口 |
| `MILVUS_USERNAME` | - | Milvus 用户名 |
| `MILVUS_PASSWORD` | - | Milvus 密码 |

### Agent 防护配置
| 变量 | 默认值 | 说明 |
|------|--------|------|
| `AGENT_GUARD_ENABLED` | true | 启用防护系统 |
| `AGENT_FAILURE_THRESHOLD` | 3 | 熔断器阈值 |
| `AGENT_TOOL_CALL_LIMIT` | 12 | 单次会话最大工具调用次数 |
| `AGENT_MODEL_CALL_LIMIT` | 25 | 单次会话最大 LLM 调用次数 |

### 发布预检配置
| 变量 | 默认值 | 说明 |
|------|--------|------|
| `SCORE_WEIGHT_PRODUCTION` | 15 | 生产环境权重 |
| `SCORE_WEIGHT_PEAK_WINDOW` | 10 | 高峰时段权重 |
| `SCORE_WEIGHT_EMERGENCY` | 20 | 紧急发布权重 |
| `SCORE_WEIGHT_DATABASE_CHANGE` | 15 | 数据库变更权重 |
| `SCORE_WEIGHT_CONFIG_CHANGE` | 8 | 配置变更权重 |
| `SCORE_WEIGHT_LARGE_CHANGE` | 12 | 大规模变更权重 |
| `SCORE_WEIGHT_ACTIVE_ALERTS` | 20 | 活跃告警权重 |
| `SCORE_WEIGHT_MISSING_RUNBOOK` | 15 | 缺失运维手册权重 |
| `SCORE_WEIGHT_RECENT_INCIDENT` | 10 | 近期事故权重 |
| `SCORE_WEIGHT_MISSING_DEPLOYMENT_HISTORY` | 8 | 缺失部署历史权重 |

## 开发命令

```bash
# 类型检查
make typecheck

# 运行测试
make test

# 开发模式（自动重载）
make dev

# 构建
make build

# 全部检查
make check
```

## 许可证

MIT
