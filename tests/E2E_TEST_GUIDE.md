# 端到端测试指南

## 前提条件

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量（至少需要一个 LLM API Key）
cp .env.example .env
# 编辑 .env，填入 OPENAI_API_KEY

# 3. (可选) 启动 Milvus
docker compose up -d

# 4. 启动服务
make dev
```

## 测试所有 API 端点

### 1. 健康检查

```bash
# Milvus 健康检查（无 Milvus 时返回 disabled）
curl http://localhost:9900/milvus/health
```

### 2. Chat 智能问答

```bash
# 同步对话
curl -X POST http://localhost:9900/api/chat \
  -H "Content-Type: application/json" \
  -d '{"question": "你好，请介绍一下自己"}'

# 流式对话
curl -X POST http://localhost:9900/api/chat_stream \
  -H "Content-Type: application/json" \
  -d '{"question": "什么是 SRE？"}'
```

### 3. AIOps 自动分析

```bash
# 自动告警分析（SSE 流式）
curl -N http://localhost:9900/api/ai_ops \
  -H "Content-Type: application/json" \
  -d '{}'
```

### 4. 代码审查

```bash
# 同步审查
curl -X POST http://localhost:9900/api/code-review/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "projectPath": "/path/to/your/project",
    "baseRef": "main",
    "headRef": "HEAD",
    "permissionGranted": true,
    "operator": "test-user"
  }'

# 流式审查
curl -N -X POST http://localhost:9900/api/code-review/analyze/stream \
  -H "Content-Type: application/json" \
  -d '{
    "projectPath": "/path/to/your/project",
    "baseRef": "main",
    "headRef": "HEAD",
    "permissionGranted": true,
    "operator": "test-user"
  }'

# 查询最新审查
curl http://localhost:9900/api/code-review?limit=10

# 查询审查配置
curl http://localhost:9900/api/code-review/config
```

### 5. 发布预检

```bash
# 同步预检
curl -X POST http://localhost:9900/api/release/precheck \
  -H "Content-Type: application/json" \
  -d '{
    "serviceName": "payment-service",
    "environment": "prod",
    "changeSummary": "升级支付网关 SDK",
    "operator": "test-user"
  }'

# 流式预检
curl -N -X POST http://localhost:9900/api/release/precheck/stream \
  -H "Content-Type: application/json" \
  -d '{
    "serviceName": "payment-service",
    "environment": "prod",
    "changeSummary": "升级支付网关 SDK"
  }'
```

### 6. 文件上传

```bash
# 上传文件
curl -X POST http://localhost:9900/api/upload \
  -F "file=@./README.md"
```

## 前端测试

在浏览器中打开: http://localhost:9900

功能验证清单：
- [ ] 左侧边栏显示导航菜单
- [ ] Chat 模式可正常对话
- [ ] 流式对话实时显示
- [ ] Code Review 表单提交正常
- [ ] AI Ops 按钮触发自动分析
- [ ] 文件上传拖拽正常
- [ ] Markdown 渲染正常
- [ ] 代码高亮正常
- [ ] 暗色主题显示正确
- [ ] 响应式布局（桌面/平板）
