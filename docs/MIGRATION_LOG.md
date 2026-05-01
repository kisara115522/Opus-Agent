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
| DateTime tool | `completed` | 2 | |
| InternalDocs tool | `completed` | 2 | RAG vector search |
| QueryMetrics tool | `completed` | 2 | Prometheus alerts + mock |
| QueryLogs tool | `completed` | 2 | Cloud logs mock |
| 熔断器 (circuit-breaker) | `completed` | 2 | 39 个单元测试 |
| 调用限制 guards | `completed` | 2 | ToolCallLimit + ModelCallLimit |
| ReAct Agent 封装 | `completed` | 2 | generateText + streamText + guards |
| Chat service | `completed` | 3 | buildSystemPrompt, createChatSession, executeChat, executeChatStream |
| RAG service | `completed` | 3 | queryWithContext, queryWithContextStream |
| 会话管理 | `completed` | 3 | Map<string, SessionState> + 滑动窗口 (max 6 pairs) |
| Chat 路由 | `completed` | 3 | 4 个端点: chat, chat_stream, clear, session |
| 风险评分引擎 | `completed` | 4 | 10 因子加权评分 |
| 发布预检 Agent 服务 | `completed` | 4 | Planner/Executor/Reporter 模式 |
| 发布预检报告服务 | `completed` | 4 | buildSummary + buildMarkdown |
| 发布预检历史/审计 | `completed` | 4 | JsonFileStore + 文件持久化 |
| 发布预检路由 | `completed` | 4 | 8 端点 |
| Git 工具 | `completed` | 5 | runGit + collectCommits + collectChangedFiles + collectPatches |
| 代码审查服务 | `completed` | 5 | 6 步审查流水线 + 12 规则检查 |
| 代码审查 Agent 服务 | `completed` | 5 | Planner/Reviewer/Judge 三阶段 |
| 代码审查报告服务 | `completed` | 5 | buildSummary + buildMarkdown |
| 代码审查历史 | `completed` | 5 | 内存 Map + 文件原子写入 |
| 代码审查路由 | `completed` | 5 | 8 端点 |
| 文件上传路由 | `completed` | 6 | POST /api/upload + 向量索引 |
| 健康检查路由 | `completed` | 6 | GET /milvus/health |
| 前端静态文件 | `completed` | 6 | @hono/node-server serveStatic |
| Makefile | `completed` | 7 | dev/build/test/typecheck/start |
| API 兼容性测试 | `completed` | 7 | TypeScript 编译 + 63 测试通过 |
| 文档收尾 | `completed` | 7 | ARCHITECTURE + MIGRATION_LOG + ORCHESTRATOR_STATE |

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

### 2026-05-01: Agent Guards + ReAct Agent

**完成内容**:
- `src/agents/guards/circuit-breaker.ts` - 工具失败熔断器，按 tool name 追踪连续失败
- `src/agents/guards/tool-call-limit.ts` - 工具调用次数限制（默认 12）
- `src/agents/guards/model-call-limit.ts` - 模型调用次数限制（默认 25）
- `src/agents/guards/index.ts` - Guards barrel export + GuardSuite 工厂
- `src/agents/react-agent.ts` - ReAct Agent 封装，集成 guards
- `src/agents/index.ts` - Agents barrel export
- `tests/unit/circuit-breaker.test.ts` - 39 个单元测试，全部通过

**关键决策**:
- Guards 通过包装工具 execute 函数实现，在工具执行边界强制执行防护
- maxSteps 设置为 modelCallLimit，限制总 LLM 调用次数
- Circuit breaker 失败检测：JSON 解析 (success/status 字段) + 关键字匹配
- ReAct Agent 同时支持同步 (generateText) 和流式 (streamText) 模式
- 使用 Vercel AI SDK v4.3.19 的 maxSteps API（非 v5 的 stopWhen）

### 2026-05-01: Chat Service + RAG Service

**完成内容**:
- `src/services/chat.service.ts` - Chat 服务，封装系统提示词构建和 Agent 会话管理
  - `buildSystemPrompt(history)` - 构建系统提示词，注入对话历史
  - `createChatSession(provider, tools, config, history)` - 创建带工具和防护的 ReAct Agent 会话
  - `executeChat(session, question)` - 同步对话执行
  - `executeChatStream(session, question)` - 流式对话执行
- `src/services/rag.service.ts` - RAG 服务，结合向量检索和 LLM 生成
  - `queryWithContext(question, options)` - 同步 RAG 查询（检索 + 上下文构建 + 生成）
  - `queryWithContextStream(question, options)` - 流式 RAG 查询
  - `RagService` 类 + `createRagService()` 工厂函数

**关键决策**:
- ChatService 保留 Java 版本的系统提示词原文（WORK_RULES.md §6）
- RAG 服务使用 Vercel AI SDK 的 generateText/streamText 替代 DashScope 原生 SDK
- Guard 配置通过 `as GuardConfig` 类型断言处理 Zod 推断的可选字段问题
- RAG 服务通过构造函数注入依赖（milvusClient, embeddingConfig, llmProvider, config）
- 流式 RAG 在无搜索结果时返回合成流而非抛出错误

### 2026-05-01: HTTP Server + Routes

**完成内容**:
- `src/server/middleware/cors.ts` - CORS 中间件，允许所有来源（匹配 Java WebMvcConfig）
- `src/server/middleware/error-handler.ts` - 全局错误处理中间件，返回 CommonResponse 格式 JSON
- `src/server/middleware/static-files.ts` - 静态文件服务中间件（@hono/node-server serveStatic）
- `src/routes/chat.ts` - Chat 路由，移植 ChatController.java 全部 4 个端点
  - `POST /api/chat` - 同步对话（返回 JSON）
  - `POST /api/chat_stream` - SSE 流式对话（Hono streamSSE）
  - `POST /api/chat/clear` - 清除会话历史
  - `GET /api/chat/session/:id` - 获取会话信息
  - 会话管理: Map<string, SessionState> + 滑动窗口（max 6 message pairs）
- `src/routes/health.ts` - 健康检查路由（GET /milvus/health）
- `src/server/app.ts` - Hono 应用组装（中间件 + 路由挂载）
- `src/server/index.ts` - Server 模块 barrel export
- `src/routes/index.ts` - Routes 模块 barrel export
- `src/index.ts` - 重写入口点，启动 Hono 服务器

**关键决策**:
- 使用 Hono 的 streamSSE() 辅助函数实现 SSE 流式响应
- 会话管理在路由层实现（Map<string, SessionState>），与 ChatService 分离
- Chat 路由通过 ChatRouteDeps 接口注入依赖（providerRegistry, config, tools）
- 入口点按顺序初始化: config -> providers -> milvus -> tools -> app -> serve
- 优雅关闭: SIGTERM/SIGINT 信号触发 Milvus 连接关闭
- SSE 流式超时设置 5 分钟（匹配 Java SseEmitter 超时）
- 错误处理使用 CommonResponse 包装，保持 API 兼容

### 2026-05-01: Phase 4 - 发布预检完成

**完成内容**:
- `src/services/risk-scoring.service.ts` - 10 因子加权评分引擎，精确移植 Java 版本
- `src/services/release-report.service.ts` - buildSummary + buildMarkdown 报告生成
- `src/services/precheck-history.service.ts` - JsonFileStore 文件持久化
- `src/services/precheck-weight-audit.service.ts` - 权重变更审计日志
- `src/services/release-precheck-agent.service.ts` - Planner/Executor/Reporter 多 Agent 模式
- `src/services/release-precheck.service.ts` - 编排服务
- `src/routes/release.ts` - 8 个端点（同步/流式审查、配置、历史、反馈等）

**关键决策**:
- 使用 Vercel AI SDK generateText 替代 DashScope ReactAgent
- 权重审计使用 randomUUID() 生成记录 ID
- 风险评分严格对齐 Java 版本 10 因子权重配置

---

### 2026-05-01: Phase 5 - 代码审查（进行中）

**完成内容**:
- `src/services/code-review-report.service.ts` - 审查报告组装（buildSummary + buildMarkdown）
- `src/services/code-review-agent.service.ts` - 多 Agent 审查（Planner/Reviewer/Judge）
- `src/services/code-review.service.ts` - 6 步审查流水线
- `src/services/review-history.service.ts` - 审查历史持久化
- `src/routes/review.ts` - 8 个端点
- `src/server/app.ts` - 挂载审查路由

**关键决策**:
- Agent 模式使用 Vercel AI SDK generateText 顺序调用 3 个 Agent
- 审查历史使用内存 Map + 文件原子写入
- SSE 流式审查复用 Hono streamSSE 模式

### 2026-05-01: Phase 5 集成完成

**完成内容**:
- 更新 `src/index.ts` 入口点：创建 ReviewHistoryService + CodeReviewService
- 更新 `src/server/app.ts`：AppDeps 接口增加 codeReviewService，替换 stub 为真实服务
- 修复 ReviewHistoryService / CodeReviewService / routes 之间的 null/undefined 类型不匹配
- TypeScript 编译通过，63 测试全部通过

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
| `WebMvcConfig.java` | `server/middleware/cors.ts` | CORS 配置 |
| `application.yml` | `config/index.ts` | 所有配置项 |
