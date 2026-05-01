# 迁移日志

记录 super-biz-agent-ts 项目的迁移进度、遇到的问题和关键决策。

---

## 模块状态总览

| 模块 | 状态 | Phase | 备注 |
|------|------|-------|------|
| 项目骨架 (package.json, tsconfig) | `pending` | 1 | |
| 配置模块 (config) | `pending` | 1 | |
| Provider 抽象层 | `pending` | 1 | 多 provider，不绑定 DashScope |
| Milvus 客户端 | `pending` | 1 | |
| Embedding 客户端 | `pending` | 1 | 多 provider embedding |
| 文档分片服务 | `pending` | 1 | |
| 向量索引/搜索服务 | `pending` | 1 | |
| Skills 系统骨架 | `pending` | 1 | 预留，空实现 |
| Chat Channel 骨架 | `pending` | 1 | 预留，空实现 |
| Event Bus 骨架 | `pending` | 1 | 预留，空实现 |
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
