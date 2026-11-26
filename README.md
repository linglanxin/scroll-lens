# ScrollLens（卷镜）

> 一款面向个人自部署与开源社区的**极轻量、低成本、多用户隔离、自带 API Key（BYOK）**双模式 AI 问答工具，专为 **2000 万字级超长连载网文**与**日常办公/学习文档**设计。

- 技术设计文档：[docs/design_doc.md](docs/design_doc.md)
- 前端交接文档：[docs/FRONTEND_HANDOFF.md](docs/FRONTEND_HANDOFF.md)
- 开源协议：[MIT License](LICENSE)

## 仓库结构与完成度

- [`backend/`](backend/pyproject.toml)（**已完成**）：FastAPI + SQLite FTS5 (`content=''`) 双模式后端、多用户鉴权/隔离、3 协议 BYOK 适配层、6 工具查书 Agent 与卷纲生成。
- [`android-shell/`](android-shell/app/build.gradle.kts)（**已完成**）：通用开源 Kotlin WebView 套壳工程（包名 `io.github.scrolllens.app`），内置多服务器地址管理与 `/api/v1/health` 连通性测试、文件选择器上传、实体返回键与 `window.ScrollLensApp` JS Bridge。
- [`.github/workflows/`](.github/workflows/build-apk.yml)（**已完成**）：推送 `v*` Tag 或手动触发即可云端自动构建通用 APK 并发布 GitHub Release，另附后端 Python 3.10/3.12 CI。
- [`deploy/`](deploy/install-ecs.sh)（**已完成**）：Ubuntu 22.04 ECS 一键部署脚本 `install-ecs.sh`、`systemd` 服务模板、`nginx.conf.example`（含 120M 上传与 SSE 禁缓冲配置）及轻量化 `Dockerfile` / `docker-compose.yml`。
- `frontend/`（**待开发**）：按计划交接给前端开发（详见 [docs/FRONTEND_HANDOFF.md](docs/FRONTEND_HANDOFF.md)）。

## 本地快速运行（后端）

```bash
cd backend
uv venv --python 3.12 .venv
uv pip install --python .venv/Scripts/python.exe -e ".[dev]"

# 启动服务
.venv/Scripts/uvicorn.exe app.main:app --reload --host 127.0.0.1 --port 8000
```

## 运行测试与实机冒烟脚本

```bash
cd backend
# 全量单元 + 集成 + 500 万字压测
.venv/Scripts/python.exe -m pytest tests -v

# 用你自己的真实小说文件或真实 API Key 做一键冒烟验证
.venv/Scripts/python.exe scripts/smoke_test_live.py --novel "path/to/novel.txt" --keyword "主角名"
.venv/Scripts/python.exe scripts/smoke_test_live.py --protocol openai_compat --base-url "https://api.deepseek.com/v1" --api-key "sk-xxx" --model "deepseek-chat"
```

## 生产部署（Ubuntu 22.04 / 2GB 内存 ECS）

1. 将仓库拉取至 `/opt/scroll-lens`，运行 `sudo bash deploy/install-ecs.sh`（自动建 venv、生成密钥、安装并启动 `scroll-lens.service`）。
2. 参考 `deploy/nginx.conf.example` 配置反向代理与 HTTPS。
3. 使用 GitHub Actions（推送 `v1.0.0` 等 Tag）自动构建通用安卓 APK，安装后填写你的服务器地址即可使用。
