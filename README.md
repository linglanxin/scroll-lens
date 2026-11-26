# ScrollLens（卷镜）

> 一款面向个人自部署与开源社区的**极轻量、低成本、多用户隔离、自带 API Key（BYOK）**双模式 AI 问答工具，专为 **2000 万字级超长连载网文**与**日常办公/学习文档**设计。

- 技术设计文档：[docs/design_doc.md](docs/design_doc.md)
- 前端交接文档：[docs/FRONTEND_HANDOFF.md](docs/FRONTEND_HANDOFF.md)
- 开源协议：[MIT License](LICENSE)

## 当前进展

- **阶段 1（后端核心 MVP）**：已完成
  - 多用户账号注册/登录（JWT + Argon2）、首用户自动成为管理员、注册开关/邀请码/上传大小管控
  - 网文模式：UTF-8 / GB18030 TXT 与 EPUB 原书分卷解析、连载增量追更、无冗余 `content=''` SQLite FTS5 + 别名保留分词、可选按卷生成卷纲（支持超长卷分段压缩与断点续跑）、严格防剧透进度锁、6 工具查书 Agent
  - 日常文档模式：纯文字 PDF / PPTX / DOCX / MD / TXT 分页解析、低文字密度/疑似扫描页标记（预留 v1.1 视觉 OCR 钩子）、`<40k` 直读与 `>=40k` 分页 FTS5 智能分流
  - 多协议 BYOK 适配层：OpenAI 兼容（DeepSeek / ChatGPT / 硅基流动 / OpenRouter / One-API 中转站）、Anthropic 原生、Google Gemini 原生，带 Fernet 密钥加密、模型列表拉取、两级连通性/Tool Calling 自检与 ReAct 文本降级模式
- **阶段 2（前端骨架与 UI）**：待交接前端开发（详见 [docs/FRONTEND_HANDOFF.md](docs/FRONTEND_HANDOFF.md)）
- **阶段 3（ECS 部署与通用安卓套壳 APK）**：待开展（已提供 `deploy/` 模板）

## 本地快速运行（后端）

```bash
cd backend
uv venv --python 3.12 .venv
# Windows: .venv\Scripts\python.exe -m pip install -e ".[dev]"
# Linux/macOS: .venv/bin/python -m pip install -e ".[dev]"
uv pip install --python .venv/Scripts/python.exe -e ".[dev]"

# 启动服务
.venv/Scripts/uvicorn.exe app.main:app --reload --host 127.0.0.1 --port 8000
```

## 运行测试

```bash
cd backend
.venv/Scripts/python.exe -m pytest tests -v
```

## 生产部署（Ubuntu 22.04 / 2GB 内存 ECS）

1. 复制 `deploy/.env.example` 为 `deploy/.env`，填入随机长密钥 `APP_SECRET_KEY`。
2. 在 `/opt/scroll-lens/backend` 下创建 Python 3.10+ `venv` 并安装 `pip install .`。
3. 使用 `deploy/scroll-lens.service` 配置 systemd 常驻（单 worker，内存限制 `250M`），或使用 `deploy/Dockerfile`。
