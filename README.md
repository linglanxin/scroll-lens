# ScrollLens（卷镜）

> 一款面向个人自部署与开源社区的**极轻量、低成本、多用户隔离、自带 API Key（BYOK）**双模式 AI 问答工具，专为 **2000 万字级超长连载网文**与**日常办公/学习文档**设计。

- 技术设计文档：[docs/design_doc.md](docs/design_doc.md)
- 前端接口交接：[docs/FRONTEND_HANDOFF.md](docs/FRONTEND_HANDOFF.md)
- Claude Opus 视觉重塑指南：[docs/CLAUDE_REDESIGN_GUIDE.md](docs/CLAUDE_REDESIGN_GUIDE.md)
- 开源协议：[MIT License](LICENSE)

## 仓库结构与完成度

- [`backend/`](backend/pyproject.toml)（**已完成**）：FastAPI + SQLite FTS5 (`content=''`) 双模式后端、多用户鉴权/隔离、3 协议 BYOK 适配层、6 工具查书 Agent 与卷纲生成。
- [`frontend/`](frontend/package.json)（**功能骨架已完成，可随时交给 Claude Opus 打磨审美**）：React + Vite + Tailwind CSS + Zustand 分层前端（`types/`、`api/`、`stores/` 契约锁死，`components/` 与 `pages/` 已 100% 跑通编译与全链路功能）。
- [`android-shell/`](android-shell/app/build.gradle.kts)（**已完成**）：通用开源 Kotlin WebView 套壳工程（包名 `io.github.scrolllens.app`）。
- [`.github/workflows/`](.github/workflows/build-apk.yml)（**已完成**）：GitHub Actions 自动构建通用 APK 与后端 CI。
- [`deploy/`](deploy/install-ecs.sh)（**已完成**）：Ubuntu 22.04 ECS 一键部署脚本、systemd 模板、Nginx 配置与 Docker Compose。

## 本地快速运行

### 1. 启动后端
```powershell
cd backend
.\.venv\Scripts\uvicorn.exe app.main:app --reload --host 127.0.0.1 --port 8000
```

### 2. 前端开发 / 打包静态资源（供 FastAPI 直接托管）
```powershell
cd frontend
npm install
npm run dev    # 开发模式 (http://127.0.0.1:5173，自动代理 /api 到 8000)
npm run build  # 生成 frontend/dist/，重启或直接访问后端 8000 端口即可由 FastAPI 托管
```

## 运行后端测试与实机冒烟脚本

```powershell
cd backend
.\.venv\Scripts\python.exe -m pytest tests -v
.\.venv\Scripts\python.exe scripts/smoke_test_live.py --novel "path/to/novel.txt" --keyword "主角名"
```
