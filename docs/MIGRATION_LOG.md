# 迁移日志

记录 super-biz-agent-ts 项目的迁移进度、遇到的问题和关键决策。

---

## 模块状态总览

| 模块 | 状态 | Phase | 备注 |
|------|------|-------|------|
| 项目骨架 (package.json, tsconfig) | `completed` | 1 | |
| 配置模块 (config) | `completed` | 1 | Zod 校验，环境变量加载 |
| Provider 抽象层 | `completed` | 1 | OpenAI / Anthropic / DashScope |
| Milvus 客户端 | `completed` | 1 | @zilliz/milvus2-sdk-node |
| Embedding 客户端 | `completed` | 1 | 多 provider: OpenAI + DashScope |
| 文档分片服务 | `completed` | 1 | Markdown-aware, 含单元测试 |
| 向量索引/搜索服务 | `completed` | 1 | index + search 服务 |
| DTO 类型定义 (types/) | `completed` | 1 | CommonResponse, Chat, Release, Review, Evidence |
| 工具函数 (utils/) | `completed` | 1 | text helpers, JsonFileStore, git operations |
| Skills 系统骨架 | `completed` | 1 | 接口 + DefaultSkillRegistry |
| Chat Channel 骨架 | `completed` | 1 | 接口 + DefaultChannelRegistry + WebChannel stub |
| Event Bus 骨架 | `completed` | 1 | AgentEvent 类型 + DefaultEventBus |
| DateTime tool | `pending` | 2 | |
| InternalDocs tool | `pending` | 2 | |
| QueryMetrics tool | `pending` | 2 | |
| QueryLogs tool | `pending` | 2 | |
| 熔断器 (circuit-breaker) | `pending` | 2 | |
| 调用限制 guards | `pending` | 2 | |
| ReAct Agent 封装 | `pending` | 2 | |
| Chat service | `pending` | 3 | |
| RAG service | `pending` | 3 | |
| 会话管理 | `pending` | 3 | |
| Chat 路由 | `pending` | 3 | |
| 风险评分引擎 | `pending` | 4 | |
| 发布预检 Agent 服务 | `pending` | 4 | |
| 发布预检报告服务 | `pending` | 4 | |
| 发布预检历史/审计 | `pending` | 4 | |
| 发布预检路由 | `pending` | 4 | |
| Git 工具 | `pending` | 5 | |
| 代码审查服务 | `pending` | 5 | |
| 代码审查 Agent 服务 | `pending` | 5 | |
| 代码审查路由 | `pending` | 5 | |
| 文件上传路由 | `pending` | 6 | |
| 健康检查路由 | `pending` | 6 | |
| 前端静态文件 | `pending` | 6 | |
| Makefile | `pending` | 7 | |
| API 兼容性测试 | `pending` | 7 | |
| 文档收尾 | `pending` | 7 | |

---

## 迁移记录

### 2026-05-01: 项目启动

**完成内容**:
- 完成 Java 项目全面探索（结构、Agent 架构、工具、配置、测试）
- 完成迁移计划制定（技术栈选型、分阶段实施、扩展性预留）
- 创建项目目录 `super-biz-agent-ts/`
- 创建工作文档 (`WORK_RULES.md`, `MIGRATION_LOG.md`, `ARCHITECTURE.md`)

**关键决策**:
- 多 provider 架构，不绑定 DashScope
- 参考 Java 重写，不逐行翻译
- 预留 Skills、Channels、Events 扩展点
- 使用 Vercel AI SDK 作为 Agent 框架

**下一步**:
- Phase 1 开始: 项目骨架初始化

### 2026-05-01: Config + Provider 抽象层

**完成内容**:
- `src/config/index.ts` - Zod 校验配置模块，覆盖所有 application.yml 配置项
- `src/providers/types.ts` - LLMProvider / EmbeddingProvider 接口 + ProviderError
- `src/providers/registry.ts` - ProviderRegistry 类，支持注册/查找/默认设置
- `src/providers/openai.provider.ts` - OpenAI LLM + Embedding（@ai-sdk/openai）
- `src/providers/anthropic.provider.ts` - Anthropic LLM（@ai-sdk/anthropic）
- `src/providers/dashscope.provider.ts` - DashScope LLM + Embedding（@ai-sdk/openai-compatible）
- `src/providers/index.ts` - barrel export + createProviderRegistry() 工厂函数

**关键决策**:
- 配置模块使用 Zod safeParse，启动时即校验，配置错误快速失败
- Provider 接口返回 Vercel AI SDK 的 LanguageModel 类型，与 Agent 框架无缝对接
- DashScope 通过 @ai-sdk/openai-compatible 接入，无需自定义 HTTP 客户端
- Anthropic 不支持 Embedding，只注册 LLM provider

### 2026-05-01: Milvus + Embedding + Vector Services

**完成内容**:
- 创建 stub config (`src/config/stub.ts`) - 带硬编码默认值的配置模块
- 创建 Milvus 常量 (`src/constants/milvus.ts`) - 集合名、维度、字段名等
- 创建 Milvus 客户端 (`src/clients/milvus.client.ts`) - 连接、建集合、建索引、健康检查
- 创建 Embedding 客户端 (`src/clients/embedding.client.ts`) - 多 provider (OpenAI + DashScope)
- 创建文档分片服务 (`src/services/document-chunk.service.ts`) - Markdown 标题分割 + 段落分割 + 重叠
- 创建向量嵌入服务 (`src/services/vector-embedding.service.ts`) - 批量/单条嵌入
- 创建向量索引服务 (`src/services/vector-index.service.ts`) - 文件读取 -> 分片 -> 嵌入 -> Milvus 写入
- 创建向量搜索服务 (`src/services/vector-search.service.ts`) - 查询嵌入 -> Milvus 搜索 -> 结果解析
- 创建 24 个单元测试 (`tests/unit/document-chunk.service.test.ts`) - 全部通过

**关键决策**:
- 使用 @zilliz/milvus2-sdk-node 的 SearchSimpleReq 接口
- delete 操作使用 `filter` 字段（SDK DeleteReq 类型要求）
- Embedding 客户端通过标准 fetch API 调用 DashScope
- 文档分片重叠逻辑支持中文句号（。）、问号（？）、感叹号（！）作为句子边界

### 2026-05-01: 扩展系统骨架 + 类型定义

**完成内容**:
- `src/types/`: 全部 DTO 类型定义 (common, chat, release, review, evidence)
- `src/skills/`: Skills 系统骨架（接口 + DefaultSkillRegistry）
- `src/channels/`: Chat Channel 系统骨架（接口 + DefaultChannelRegistry + WebChannel stub）
- `src/events/`: Event Bus 骨架（AgentEvent 类型 + DefaultEventBus）
- `src/utils/`: 工具函数（text helpers, JsonFileStore, git operations）

**关键决策**:
- 类型定义严格对应 Java DTO 字段，保证 API 兼容
- SkillRegistry 使用简单关键词匹配，后续可扩展为意图识别
- EventBus 使用 Node.js EventEmitter，设置 maxListeners=50
- WebChannel 仅定义接口骨架，HTTP/SSE 实现在 Phase 3 完成

---

## 问题记录

（暂无）

---

## 参考文件索引

| Java 源文件 | 对应 TS 模块 | 备注 |
|------------|-------------|------|
| `ChatService.java` | `chat.service.ts` + `react-agent.ts` | Agent 创建和工具组装 |
| `RiskScoringService.java` | `risk-scoring.service.ts` | 10 因子评分引擎，必须精确 |
| `CodeReviewService.java` | `review/code-review.service.ts` | 最大最复杂，约 900 行 |
| `ToolFailureCircuitBreakerInterceptor.java` | `agents/guards/circuit-breaker.ts` | 熔断器逻辑 |
| `ChatController.java` | `routes/chat.ts` | SSE 流式和会话管理 |
| `application.yml` | `config/index.ts` | 所有配置项 |
