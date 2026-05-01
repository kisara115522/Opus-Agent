# Orchestrator State

本文档记录主编排器（主 Claude 会话）的当前状态，用于上下文恢复。

---

## 当前状态

- **Phase**: 1 - 基础设施
- **整体进度**: 20%（骨架完成，正在并行开发核心模块）
- **最后更新**: 2026-05-01

## 已完成

- [x] 项目目录创建
- [x] Git 初始化 + 连接远程仓库 (git@github.com:kisara115522/Opus-Agent.git)
- [x] README.md
- [x] docs/WORK_RULES.md, MIGRATION_LOG.md, ARCHITECTURE.md
- [x] package.json + tsconfig.json + vitest.config.ts + .env.example
- [x] src/index.ts 入口
- [x] npm install
- [x] Initial commit + push

## 进行中

- [ ] Agent 1 (worktree: agent-config): Config 模块 + Provider 抽象层
- [ ] Agent 2 (worktree: agent-milvus): Milvus 客户端 + Embedding 客户端 + 文档分片 + 向量服务
- [ ] Agent 3 (worktree: agent-ext): 扩展性骨架 (Skills/Channels/Events) + Types

## Agent 分配

### Agent 1: agent-config
**任务**: Config 模块 + Provider 抽象层
**文件范围**:
- src/config/index.ts
- src/providers/registry.ts
- src/providers/types.ts
- src/providers/openai.provider.ts
- src/providers/anthropic.provider.ts
- src/providers/dashscope.provider.ts

### Agent 2: agent-milvus
**任务**: Milvus + Embedding + 文档分片 + 向量服务
**文件范围**:
- src/clients/milvus.client.ts
- src/clients/embedding.client.ts
- src/services/document-chunk.service.ts
- src/services/vector-embedding.service.ts
- src/services/vector-index.service.ts
- src/services/vector-search.service.ts
- src/constants/milvus.ts
- tests/unit/document-chunk.service.test.ts

### Agent 3: agent-ext
**任务**: 扩展性骨架 + Types
**文件范围**:
- src/skills/registry.ts
- src/skills/types.ts
- src/channels/registry.ts
- src/channels/types.ts
- src/channels/web.channel.ts
- src/events/index.ts
- src/types/chat.ts
- src/types/release.ts
- src/types/review.ts
- src/types/common.ts
- src/types/evidence.ts

## 下一步（Agent 完成后）

1. Merge 所有 worktree 到 main
2. 验证编译通过 (tsc --noEmit)
3. Push
4. 进入 Phase 2: Agent 工具 + 防护

## 恢复流程

如果上下文丢失：
1. 读本文档了解当前状态
2. 读 docs/MIGRATION_LOG.md 了解模块进度
3. 读 docs/ARCHITECTURE.md 了解架构设计
4. 检查 git log 了解最近提交
5. 检查是否有未合并的 worktree: `git worktree list`
6. 继续执行下一步
