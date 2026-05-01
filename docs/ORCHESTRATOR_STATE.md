# Orchestrator State

本文档记录主编排器（主 Claude 会话）的当前状态，用于上下文恢复。

---

## 当前状态

- **Phase**: 4 - 发布预检
- **整体进度**: 70%（Phase 1-3 完成，Phase 4 进行中）
- **最后更新**: 2026-05-01

## 已完成

### Phase 1: 基础设施 ✅
Config + Providers + Milvus + Embedding + VectorServices + Types + Skills/Channels/Events + Utils

### Phase 2: Agent 工具 + 防护 ✅
4 Tools + CircuitBreaker + CallLimits + ReActAgent (63 tests passing)

### Phase 3: Chat + RAG ✅
- [x] Chat service (buildSystemPrompt, createChatSession, executeChat, executeChatStream)
- [x] RAG service (queryWithContext, queryWithContextStream)
- [x] Chat routes (4 endpoints: chat, chat_stream, clear, session)
- [x] Server setup (Hono app, CORS, error-handler, static-files)
- [x] Entry point (config -> providers -> milvus -> tools -> app -> serve)
- [x] Health route (GET /milvus/health)

## 进行中

### Phase 4: 发布预检
- [ ] Agent E (worktree: agent-scoring): Risk scoring engine + history/audit + report
- [ ] Agent F (worktree: agent-precheck): Release precheck agent + routes

## Agent 分配

### Agent E: agent-scoring
**任务**: 风险评分 + 历史/审计 + 报告服务
**文件范围**:
- src/services/risk-scoring.service.ts
- src/services/release-report.service.ts
- src/services/precheck-history.service.ts
- src/services/precheck-weight-audit.service.ts
**参考**: RiskScoringService.java, ReleaseReportService.java

### Agent F: agent-precheck
**任务**: 发布预检 Agent + 路由
**文件范围**:
- src/services/release-precheck.service.ts
- src/services/release-precheck-agent.service.ts
- src/routes/release.ts (8 端点)
**参考**: ReleasePrecheckService.java, ReleasePrecheckAgentService.java, ReleaseController.java

## 下一步

1. Merge worktrees 到 main
2. 验证编译 + 测试
3. Push
4. 进入 Phase 5: 代码审查

## 恢复流程

1. 读本文档了解当前状态
2. 读 docs/MIGRATION_LOG.md 了解模块进度
3. 读 docs/ARCHITECTURE.md 了解架构设计
4. `git log --oneline -10` 了解最近提交
5. `git worktree list` 检查未合并分支
6. 继续执行下一步
