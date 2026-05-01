# 工作规则

本文档是 Claude 在 super-biz-agent-ts 项目中的工作准则。每次会话开始时必须阅读本文档以恢复上下文。

---

## 1. 进度同步

### 1.1 必须在每次会话结束时更新 MIGRATION_LOG.md

- 记录本次会话完成了哪些模块
- 记录遇到的问题和解决方案
- 记录下一步待办事项
- 标记每个模块的状态: `pending` / `in_progress` / `completed` / `blocked`

### 1.2 代码变更必须有对应文档

- 新增的架构决策 -> 更新 `ARCHITECTURE.md`
- 新增的 provider -> 更新 `ARCHITECTURE.md` 的 Provider 章节
- 新增的扩展点 -> 更新 `ARCHITECTURE.md` 的扩展性章节

---

## 2. 上下文恢复流程

当上下文可能溢出或新会话开始时，按以下顺序阅读：

1. `docs/WORK_RULES.md`（本文件）- 工作规则
2. `docs/MIGRATION_LOG.md` - 迁移进度和当前状态
3. `docs/ARCHITECTURE.md` - 架构设计和关键决策
4. 最近修改的源文件（通过 `git log` 或 `ls -lt` 判断）

---

## 3. 编码规范

### 3.1 通用规则

- 使用 ESM（`import/export`），不用 CommonJS（`require`）
- 所有函数和变量使用 camelCase
- 类型/接口使用 PascalCase
- 文件名使用 kebab-case（如 `chat.service.ts`）
- 每个模块导出明确的公共 API，内部实现不导出

### 3.2 类型安全

- 禁止使用 `any`，除非有充分理由并在注释中说明
- 优先使用 `interface` 而非 `type`（除非需要联合类型或交叉类型）
- 所有函数参数和返回值必须有类型注解
- 使用 Zod 做运行时校验，尤其是外部输入（API 请求、配置、文件内容）

### 3.3 错误处理

- 使用自定义 Error 类（如 `ProviderError`、`ToolExecutionError`）
- 异步函数使用 `try/catch`，不要吞掉错误
- 日志必须包含足够的上下文（tool name、provider、request id 等）

### 3.4 日志

- 使用 Pino，通过 `pino` 导入
- 日志级别: `fatal` / `error` / `warn` / `info` / `debug` / `trace`
- 生产环境默认 `info`，开发环境 `debug`
- 结构化日志，不要拼接字符串

---

## 4. 测试规范

- 每个 service 必须有对应的单元测试文件
- 测试文件放在 `tests/unit/` 或 `tests/integration/` 下
- 测试命名: `<module-name>.test.ts`
- 使用 Vitest 的 `describe` / `it` / `expect`
- 外部依赖（Milvus、LLM provider）在测试中 mock
- 业务逻辑测试必须覆盖 Java 版本的测试用例

---

## 5. Git 规范

- 提交信息格式: `<type>(<scope>): <description>`
- type: `feat` / `fix` / `refactor` / `test` / `docs` / `chore`
- scope: `config` / `provider` / `agent` / `tool` / `service` / `route` / `test` / `docs`
- 每个 Phase 完成后创建一个 commit

---

## 6. 迁移原则

- **参考 Java 重写，不逐行翻译**。保留业务规则和 API 契约，用 TS 原生方式实现
- 每个模块迁移前先阅读对应的 Java 源文件，理解意图再写 TS 版本
- 优先保证 API 端点路径和请求/响应格式与 Java 版本一致（前端兼容）
- 保留 Java 版本的 prompt 文本（系统提示词、Agent 提示词），翻译为中文注释

---

## 7. 扩展性设计原则

- 预留的扩展点（Skills、Channels、Events）只定义接口和空 Registry
- 不提前实现未要求的功能
- 扩展点的接口设计参考现有成熟框架（如 LangChain tools、Slack Bolt）
- 当需要实现扩展点时，先更新 ARCHITECTURE.md 再写代码

---

## 8. 禁止事项

- 不要在代码中硬编码 API key 或密钥
- 不要跳过类型检查（`// @ts-ignore` 需要充分理由）
- 不要引入不必要的依赖（能用标准库解决的不用第三方）
- 不要修改 `vector-database.yml` 和 `release-knowledge/` 目录
- 不要实现已弃用的 AIOps 模块
