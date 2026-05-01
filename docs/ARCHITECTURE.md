# 架构设计文档

super-biz-agent-ts 的架构设计、关键决策和扩展点说明。

---

## 1. 整体架构

```
┌─────────────────────────────────────────────────────┐
│                    Hono HTTP Server                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐ │
│  │chat.ts   │ │release.ts│ │review.ts │ │upload.ts│ │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └───┬────┘ │
│       │             │            │            │      │
│  ┌────▼─────────────▼────────────▼────────────▼───┐  │
│  │              Services Layer                     │  │
│  │  chat.service / rag.service / risk-scoring /    │  │
│  │  release-precheck / code-review / vector-*      │  │
│  └────┬─────────────┬────────────┬────────────────┘  │
│       │             │            │                    │
│  ┌────▼─────┐ ┌─────▼──────┐ ┌──▼──────────────┐    │
│  │ Providers │ │  Agents    │ │  Tools          │    │
│  │ Registry  │ │ react-agent│ │ datetime/docs/  │    │
│  │ (multi)   │ │ + guards   │ │ metrics/logs    │    │
│  └──────────┘ └────────────┘ └─────────────────┘    │
│                                                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────────────────┐ │
│  │ Skills   │ │ Channels │ │ Events               │ │
│  │ (预留)    │ │ (预留)    │ │ (预留)               │ │
│  └──────────┘ └──────────┘ └──────────────────────┘ │
└─────────────────────────────────────────────────────┘
         │              │              │
    ┌────▼────┐   ┌─────▼────┐  ┌─────▼─────┐
    │ Milvus  │   │ LLM APIs │  │ Prometheus│
    │ (向量DB) │   │ (多provider)│ │ (监控)    │
    └─────────┘   └──────────┘  └───────────┘
```

---

## 2. 多 Provider 架构

### 2.1 设计目标

- 不绑定任何单一 LLM 提供商
- 通过配置切换 provider，无需改代码
- 支持不同 provider 的不同模型（chat model、embedding model 独立选择）

### 2.2 Provider 接口

```typescript
// src/providers/types.ts

interface LLMProvider {
  name: string;
  chatModel(modelId: string): LanguageModel;  // Vercel AI SDK 类型
  isAvailable(): boolean;
}

interface EmbeddingProvider {
  name: string;
  embed(texts: string[]): Promise<number[][]>;
  isAvailable(): boolean;
}
```

### 2.3 ProviderRegistry

```typescript
// src/providers/registry.ts

class ProviderRegistry {
  private llmProviders = new Map<string, LLMProvider>();
  private embeddingProviders = new Map<string, EmbeddingProvider>();

  registerLLM(provider: LLMProvider): void;
  registerEmbedding(provider: EmbeddingProvider): void;
  getLLM(name: string): LLMProvider;
  getEmbedding(name: string): EmbeddingProvider;
  getDefaultLLM(): LLMProvider;
  getDefaultEmbedding(): EmbeddingProvider;
}
```

### 2.4 已实现的 Provider

| Provider | LLM | Embedding | 接入方式 |
|----------|-----|-----------|---------|
| OpenAI | `@ai-sdk/openai` | `@ai-sdk/openai` | 原生 |
| Anthropic | `@ai-sdk/anthropic` | N/A | 原生 |
| DashScope | `@ai-sdk/openai-compatible` | 直接 fetch | OpenAI 兼容 |

### 2.5 配置示例

```env
# .env
LLM_PROVIDER=openai
LLM_MODEL=gpt-4o
OPENAI_API_KEY=sk-xxx

EMBEDDING_PROVIDER=openai
EMBEDDING_MODEL=text-embedding-3-small

# 或使用 DashScope
# LLM_PROVIDER=dashscope
# LLM_MODEL=qwen-max
# DASHSCOPE_API_KEY=sk-xxx
```

---

## 3. Agent 架构

### 3.1 ReAct Agent 封装

```typescript
// src/agents/react-agent.ts

interface ReactAgentConfig {
  name: string;
  provider: LLMProvider;
  modelId: string;
  systemPrompt: string;
  tools: Record<string, Tool>;
  guards?: GuardConfig;
  maxSteps?: number;
}

interface GuardConfig {
  enabled: boolean;
  failureThreshold: number;     // 连续失败阈值
  toolCallLimit: number;        // 工具调用总次数限制
  modelCallLimit: number;       // 模型调用总次数限制
  limitMessage: string;         // 触达限制时的消息
}

async function createReactAgent(config: ReactAgentConfig): Promise<Agent>;
```

### 3.2 Agent Guard 机制

参考 Java 版本的三层防护：

1. **CircuitBreaker**: 按 tool name 追踪连续失败，阈值=3 后短路
2. **ToolCallLimit**: 总工具调用次数限制（默认 12）
3. **ModelCallLimit**: 总模型调用次数限制（默认 25）

实现方式：在 ReAct 循环中作为 `stopWhen` 条件和中间件。

---

## 4. Skills 系统（预留）

### 4.1 设计思路

参考 GitHub Skills 模式，每个 Skill 是一个可注册的模块，包含：
- 名称和描述
- 触发条件（关键词、意图匹配）
- 执行逻辑（调用 tools、LLM 或外部 API）

### 4.2 接口定义

```typescript
// src/skills/types.ts

interface Skill {
  name: string;
  description: string;
  triggers: string[];           // 触发关键词
  execute(context: SkillContext): Promise<SkillResult>;
}

interface SkillContext {
  message: string;
  sessionId: string;
  channel: string;
  tools: Record<string, Tool>;
}

interface SkillRegistry {
  register(skill: Skill): void;
  match(message: string): Skill | null;
  list(): Skill[];
}
```

---

## 5. Chat Channel 系统（预留）

### 5.1 设计思路

统一消息协议，支持多渠道接入。每个 Channel 实现相同的消息收发接口。

### 5.2 接口定义

```typescript
// src/channels/types.ts

interface ChatChannel {
  name: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onMessage(handler: MessageHandler): void;
  sendMessage(channelId: string, message: OutgoingMessage): Promise<void>;
}

interface IncomingMessage {
  channel: string;              // 来源渠道 (web, slack, discord)
  channelId: string;            // 渠道内的会话 ID
  userId: string;
  content: string;
  metadata?: Record<string, unknown>;
}

interface OutgoingMessage {
  content: string;
  format: 'text' | 'markdown' | 'sse';
  metadata?: Record<string, unknown>;
}

type MessageHandler = (message: IncomingMessage) => Promise<void>;

interface ChannelRegistry {
  register(channel: ChatChannel): void;
  get(name: string): ChatChannel;
  list(): ChatChannel[];
}
```

---

## 6. Event Bus（预留）

### 6.1 设计思路

简单的事件驱动钩子系统，用于在 agent 生命周期的关键节点插入自定义逻辑。

### 6.2 事件类型

```typescript
// src/events/index.ts

type AgentEvent =
  | 'agent:start'               // Agent 开始执行
  | 'agent:end'                 // Agent 执行结束
  | 'tool:call'                 // 工具调用前
  | 'tool:result'               // 工具返回结果后
  | 'tool:error'                // 工具调用出错
  | 'model:call'                // 模型调用前
  | 'model:response'            // 模型返回结果后
  | 'guard:trip'                // 防护触发（熔断、限制）
  | 'session:create'            // 会话创建
  | 'session:expire';           // 会话过期

interface EventBus {
  on(event: AgentEvent, handler: (payload: unknown) => void): void;
  emit(event: AgentEvent, payload: unknown): void;
  off(event: AgentEvent, handler: (payload: unknown) => void): void;
}
```

---

## 7. API 端点兼容性

以下端点路径必须与 Java 版本完全一致，确保前端无需修改：

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/chat` | 同步对话 |
| POST | `/api/chat_stream` | SSE 流式对话 |
| POST | `/api/chat/clear` | 清除会话 |
| GET | `/api/chat/session/:id` | 获取会话信息 |
| POST | `/api/code-review/analyze` | 同步代码审查 |
| POST | `/api/code-review/analyze/stream` | SSE 流式代码审查 |
| GET | `/api/code-review/:id` | 获取审查结果 |
| GET | `/api/code-review` | 列出最近审查 |
| GET | `/api/code-review/config` | 获取审查配置 |
| POST | `/api/release/precheck` | 同步发布预检 |
| POST | `/api/release/precheck/stream` | SSE 流式发布预检 |
| GET | `/api/release/precheck/:id` | 获取预检结果 |
| POST | `/api/release/precheck/:id/feedback` | 提交反馈 |
| GET | `/api/release/precheck` | 列出最近预检 |
| GET | `/api/release/precheck/config` | 获取预检配置 |
| POST | `/api/release/precheck/config/weights` | 更新评分权重 |
| GET | `/api/release/precheck/config/weights/audit` | 权重变更审计 |
| POST | `/api/upload` | 上传文件并入库 |
| GET | `/milvus/health` | Milvus 健康检查 |

---

## 8. 数据流

### 8.1 Chat 流程

```
用户请求 -> ChatRoute -> ChatService
  -> ProviderRegistry.getDefaultLLM()
  -> createReactAgent({ tools, guards })
  -> agent.stream(messages)
  -> SSE 响应
```

### 8.2 Release Precheck 流程

```
用户请求 -> ReleaseRoute -> ReleasePrecheckService
  -> ReleasePrecheckAgentService (Planner/Executor/Reporter)
     -> Tools: queryPrometheusAlerts, queryInternalDocs
  -> RiskScoringService.score(request, evidence)
  -> ReleaseReportService.buildReport()
  -> PrecheckHistoryService.save()
  -> 响应
```

### 8.3 Code Review 流程

```
用户请求 -> CodeReviewRoute -> CodeReviewService
  -> GitUtils: collectCommits, collectChangedFiles, collectPatches
  -> RuleEngine: evaluateRisk (规则评估)
  -> RagEvidence: queryInternalDocs (RAG 证据)
  -> CodeReviewAgentService: Planner -> Reviewer -> Judge
  -> CodeReviewReportService.buildReport()
  -> CodeReviewHistoryService.save()
  -> 响应
```

---

## 9. 配置结构

所有配置通过 Zod schema 校验，从环境变量和 `.env` 文件加载：

```typescript
const configSchema = z.object({
  server: z.object({
    port: z.number().default(9900),
  }),
  llm: z.object({
    provider: z.enum(['openai', 'anthropic', 'dashscope']),
    model: z.string(),
    apiKey: z.string(),
  }),
  embedding: z.object({
    provider: z.enum(['openai', 'dashscope']),
    model: z.string(),
    apiKey: z.string(),
  }),
  milvus: z.object({
    host: z.string().default('localhost'),
    port: z.number().default(19530),
    // ...
  }),
  rag: z.object({
    topK: z.number().default(3),
    model: z.string().default('gpt-4o'),
  }),
  agent: z.object({
    guard: z.object({
      enabled: z.boolean().default(true),
      failureThreshold: z.number().default(3),
      toolCallLimit: z.number().default(12),
      modelCallLimit: z.number().default(25),
    }),
  }),
  // ... release.precheck, code.review, prometheus, cls
});
```
