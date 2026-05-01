# Opus Agent

Enterprise-grade intelligent operations agent system built with TypeScript.

## Features

- **RAG Chat** - Intelligent Q&A with vector retrieval and multi-provider LLM support
- **Release Precheck** - Pre-deployment risk assessment with rule-based scoring
- **Code Review** - Git diff analysis with multi-agent deep review (Planner/Reviewer/Judge)

## Architecture

- **Runtime**: Node.js 20+ with TypeScript 5.4+
- **Web Framework**: Hono
- **Agent Framework**: Vercel AI SDK (multi-provider: OpenAI, Anthropic, DashScope)
- **Vector Database**: Milvus
- **Validation**: Zod
- **Logging**: Pino
- **Testing**: Vitest

## Quick Start

```bash
# Install dependencies
pnpm install

# Copy env config
cp .env.example .env

# Start Milvus vector database
docker-compose -f vector-database.yml up -d

# Start the server
pnpm dev

# Upload knowledge base documents
make upload
```

## Project Structure

```
src/
├── index.ts              # Entry point
├── config/               # Configuration (Zod-validated)
├── server/               # Hono app + middleware
├── routes/               # API routes (chat, release, code-review, upload, health)
├── services/             # Business logic
├── agents/               # ReAct agent + guards (circuit breaker, call limits)
├── providers/            # Multi LLM provider abstraction
├── tools/                # Agent tools (datetime, docs, metrics, logs)
├── skills/               # Skills system (extensible)
├── channels/             # Chat channels (extensible)
├── events/               # Event bus (extensible)
├── clients/              # Milvus + embedding clients
├── types/                # TypeScript interfaces
├── utils/                # Git, file, text utilities
└── constants/            # Constants
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/chat` | Synchronous chat |
| POST | `/api/chat_stream` | SSE streaming chat |
| POST | `/api/code-review/analyze` | Code review |
| POST | `/api/release/precheck` | Release precheck |
| POST | `/api/upload` | Upload + vectorize documents |
| GET | `/milvus/health` | Health check |

## Configuration

Configuration via environment variables or `.env` file. See `.env.example` for all options.

Key settings:
- `LLM_PROVIDER` - LLM provider (openai / anthropic / dashscope)
- `LLM_MODEL` - Model name
- `EMBEDDING_PROVIDER` - Embedding provider
- `MILVUS_HOST` - Milvus host (default: localhost)
- `MILVUS_PORT` - Milvus port (default: 19530)

## License

MIT
