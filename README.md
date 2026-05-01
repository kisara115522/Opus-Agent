# SuperBiz Agent (TypeScript)

Enterprise-grade intelligent operations agent system - ported from Java to TypeScript.

[中文文档](README_CN.md)

## Features

### RAG Chat
- Intelligent Q&A with vector retrieval (Milvus)
- Multi-provider LLM support (OpenAI, Anthropic, DashScope)
- Session management with sliding window history
- SSE streaming responses

### Release Precheck
- 10-factor weighted risk scoring engine
- Multi-agent pattern (Planner/Executor/Reporter)
- File-persistent history and weight audit logs
- Generates structured markdown reports

### Code Review
- 6-step pipeline: validate -> collect git -> evaluate risks -> RAG evidence -> agent review -> assemble report
- 12 rule-based risk checks (sensitive values, missing tests, config changes, etc.)
- Multi-agent deep review (Planner/Reviewer/Judge)
- SSE streaming with progress updates

### AIOps Auto Analysis
- Automatic alert diagnosis using AI agent loop
- Fetches active alerts and correlates metrics/logs automatically
- Generates root cause analysis and remediation suggestions
- SSE streaming with real-time progress updates

### File Upload
- Multipart file upload with extension validation
- Auto-vectorization for RAG knowledge base

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Hono HTTP Server                  │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐ ┌────────┐ │
│  │chat.ts   │ │release.ts│ │review.ts │ │upload.ts│ │ai-ops.ts│ │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └───┬────┘ └───┬────┘ │
│       │             │            │            │      │
│  ┌────▼─────────────▼────────────▼────────────▼───┐  │
│  │              Services Layer                     │  │
│  │  chat / rag / risk-scoring / release-precheck / │  │
│  │  code-review / ai-ops / vector-*                │  │
│  └────┬─────────────┬────────────┬────────────────┘  │
│       │             │            │                    │
│  ┌────▼─────┐ ┌─────▼──────┐ ┌──▼──────────────┐    │
│  │ Providers │ │  Agents    │ │  Tools          │    │
│  │ (multi)   │ │ react-agent│ │ datetime/docs/  │    │
│  │           │ │ + guards   │ │ metrics/logs    │    │
│  └──────────┘ └────────────┘ └─────────────────┘    │
└─────────────────────────────────────────────────────┘
         │              │              │
    ┌────▼────┐   ┌─────▼────┐  ┌─────▼─────┐
    │ Milvus  │   │ LLM APIs │  │ Prometheus│
    │ (向量DB) │   │ (multi)  │  │ (监控)    │
    └─────────┘   └──────────┘  └───────────┘
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Runtime | Node.js 20+ |
| Language | TypeScript 5.4+ |
| Web Framework | Hono |
| Agent Framework | Vercel AI SDK |
| LLM Providers | OpenAI, Anthropic, DashScope |
| Vector Database | Milvus (@zilliz/milvus2-sdk-node) |
| Validation | Zod |
| Logging | Pino |
| Testing | Vitest |

## Quick Start

```bash
# Install dependencies
npm install

# Copy env config
cp .env.example .env

# Edit .env with your API keys and settings

# Start Milvus (if using Docker)
docker-compose -f vector-database.yml up -d

# Development mode
make dev

# Or directly
npx tsx --watch src/index.ts
```

## Project Structure

```
src/
├── index.ts                          # Entry point (bootstrap + serve)
├── config/
│   ├── index.ts                      # Zod-validated config singleton
│   └── stub.ts                       # Stub config for testing
├── server/
│   ├── app.ts                        # Hono app factory
│   └── middleware/                    # CORS, error handler, static files
├── routes/
│   ├── chat.ts                       # Chat API (4 endpoints)
│   ├── release.ts                    # Release precheck (8 endpoints)
│   ├── review.ts                     # Code review (8 endpoints)
│   ├── ai-ops.ts                     # AIOps auto-analysis
│   ├── upload.ts                     # File upload
│   └── health.ts                     # Health check
├── services/
│   ├── chat.service.ts               # Chat + session management
│   ├── rag.service.ts                # RAG (vector search + LLM)
│   ├── risk-scoring.service.ts       # 10-factor risk scoring
│   ├── release-precheck.service.ts   # Release precheck orchestrator
│   ├── release-precheck-agent.service.ts  # Multi-agent (Planner/Executor/Reporter)
│   ├── release-report.service.ts     # Report generation
│   ├── precheck-history.service.ts   # File-persistent history
│   ├── precheck-weight-audit.service.ts   # Weight audit log
│   ├── code-review.service.ts        # Code review pipeline
│   ├── code-review-agent.service.ts  # Multi-agent (Planner/Reviewer/Judge)
│   ├── code-review-report.service.ts # Report generation
│   ├── review-history.service.ts     # File-persistent history
│   ├── document-chunk.service.ts     # Markdown-aware chunking
│   ├── vector-embedding.service.ts   # Embedding wrapper
│   ├── vector-index.service.ts       # File -> chunk -> embed -> Milvus
│   └── vector-search.service.ts      # Query -> embed -> Milvus search
├── agents/
│   ├── react-agent.ts                # ReAct agent with guards
│   └── guards/                       # Circuit breaker, call limits
├── providers/
│   ├── openai.provider.ts            # OpenAI (LLM + Embedding)
│   ├── anthropic.provider.ts         # Anthropic (LLM only)
│   └── dashscope.provider.ts         # DashScope (LLM + Embedding)
├── tools/
│   ├── datetime.tool.ts              # Current date/time
│   ├── internal-docs.tool.ts         # RAG vector search
│   ├── query-metrics.tool.ts         # Prometheus alerts
│   └── query-logs.tool.ts            # Cloud logs
├── types/                            # TypeScript interfaces
├── utils/                            # Git, file, text helpers
├── clients/                          # Milvus + embedding clients
├── constants/                        # Milvus constants
├── skills/                           # Skills system (extensible)
├── channels/                         # Chat channels (extensible)
└── events/                           # Event bus (extensible)
```

## API Endpoints

### Chat
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/chat` | Synchronous chat |
| POST | `/api/chat_stream` | SSE streaming chat |
| POST | `/api/chat/clear` | Clear session history |
| GET | `/api/chat/session/:id` | Get session info |

### Release Precheck
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/release/precheck` | Synchronous precheck |
| POST | `/api/release/precheck/stream` | SSE streaming precheck |
| GET | `/api/release/precheck/:id` | Get precheck result |
| GET | `/api/release/precheck` | List latest results |
| GET | `/api/release/precheck/config` | Get config |
| POST | `/api/release/precheck/feedback` | Submit feedback |
| POST | `/api/release/weights` | Update scoring weights |
| GET | `/api/release/weights/audit` | Weight audit log |

### Code Review
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/code-review/analyze` | Synchronous review |
| POST | `/api/code-review/analyze/stream` | SSE streaming review |
| GET | `/api/code-review/:id` | Get review result |
| GET | `/api/code-review` | List latest reviews |
| GET | `/api/code-review/config` | Get config |
| POST | `/api/code-review/feedback` | Submit feedback |
| GET | `/api/code-review/export/:id` | Export as markdown |
| GET | `/api/code-review/health` | Health check |

### AIOps
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/ai_ops` | SSE streaming auto-analysis |

### File Upload
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/upload` | Upload + vectorize file |

### Health
| Method | Path | Description |
|--------|------|-------------|
| GET | `/milvus/health` | Milvus health check |

## Configuration

All configuration via environment variables or `.env` file. See `.env.example` for the complete list.

### Core Settings
| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 9900 | Server port |
| `LLM_PROVIDER` | openai | LLM provider (openai/anthropic/dashscope) |
| `LLM_MODEL` | gpt-4o | LLM model name |
| `OPENAI_API_KEY` | - | OpenAI API key |
| `ANTHROPIC_API_KEY` | - | Anthropic API key |
| `DASHSCOPE_API_KEY` | - | DashScope API key |
| `EMBEDDING_PROVIDER` | openai | Embedding provider |
| `EMBEDDING_MODEL` | text-embedding-3-small | Embedding model |

### Milvus
| Variable | Default | Description |
|----------|---------|-------------|
| `MILVUS_HOST` | localhost | Milvus host |
| `MILVUS_PORT` | 19530 | Milvus port |
| `MILVUS_USERNAME` | - | Milvus username |
| `MILVUS_PASSWORD` | - | Milvus password |

### Agent Guards
| Variable | Default | Description |
|----------|---------|-------------|
| `AGENT_GUARD_ENABLED` | true | Enable guard system |
| `AGENT_FAILURE_THRESHOLD` | 3 | Circuit breaker threshold |
| `AGENT_TOOL_CALL_LIMIT` | 12 | Max tool calls per session |
| `AGENT_MODEL_CALL_LIMIT` | 25 | Max LLM calls per session |

## Development

```bash
# Type check
make typecheck

# Run tests
make test

# Development mode (auto-reload)
make dev

# Build
make build

# All checks
make check
```

## License

MIT
