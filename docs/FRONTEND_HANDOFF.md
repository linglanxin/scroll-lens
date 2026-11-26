# ScrollLens 前端开发交接文档（给 Claude）

本文档说明阶段 1（后端 MVP）已交付的完整接口契约、鉴权方式、SSE 流式协议与前端解耦目录规范。**后端已在本地跑通全量测试与千万字级压力验证，前端只需对接下列契约即可。**

---

## 1. 本地启动后端

```powershell
cd backend
.\.venv\Scripts\uvicorn.exe app.main:app --reload --host 127.0.0.1 --port 8000
```

- 健康检查：`GET http://127.0.0.1:8000/api/v1/health` -> `{"status":"ok","service":"scroll-lens"}`
- 在线 OpenAPI 文档：`http://127.0.0.1:8000/docs`
- 默认 CORS 允许：`http://localhost:5173` 与 `http://127.0.0.1:5173`（可在 `.env` 中通过 `CORS_ORIGINS` 追加）。
- 生产构建时将前端 `npm run build` 生成的 `frontend/dist/` 放到仓库根目录对应路径，FastAPI 会自动托管静态资源与 SPA 路由。

---

## 2. 前端严格分层规范（与 `docs/design_doc.md` 第 5 节一致）

```text
frontend/src/
├── api/                 # 纯接口与 SSE 流式解析客户端（锁定契约）
├── stores/              # Zustand 状态管理（登录态、当前模式、防剧透章号、会话流）
├── types/               # TypeScript 接口类型定义
├── components/          # 视觉组件层（完全自由打磨）
│   ├── layout/          # 顶栏模式切换、手机抽屉 / PC 侧边栏
│   ├── novel/           # 书架卡片、分卷大纲抽屉、防剧透进度条、原文弹窗、设定卡
│   ├── document/        # 文档上传区、页码引用弹窗、扫描页提示条
│   ├── chat/            # 聊天气泡、工具调用折叠胶囊、Markdown 与 [ch:N]/[p:N] 引用渲染
│   └── settings/        # 多模型/中转站预设卡片、一键测试按钮、管理员开关
└── pages/               # 登录/注册页、主工作台、设置页
```

**安卓套壳兼容预留**：
- 在设置页中判断 `window.ScrollLensApp?.openServerConfig`，若存在则渲染「切换/配置服务器地址」按钮并调用该方法。

---

## 3. 鉴权与通用约定

- **Token 传递**：除 `/api/v1/health`、`/api/v1/auth/registration-status`、`/api/v1/auth/register`、`/api/v1/auth/login`、`/api/v1/providers/presets` 外，所有接口均需请求头：
  `Authorization: Bearer <access_token>`
- **错误响应格式**：FastAPI 标准 `{"detail": "错误信息"}`，HTTP 状态码含 `400 / 401 / 403 / 404 / 409 / 413 / 502`。
- **首用户即管理员**：系统第一个注册的账号自动成为 `role: "admin"`。

---

## 4. 接口契约速查

### 4.1 账号与管理员 (`/api/v1/auth`, `/api/v1/admin`)

| 方法 & 路径 | 请求体 / 查询参数 | 响应结构 |
| :--- | :--- | :--- |
| `GET /api/v1/auth/registration-status` | 无 | `{"allow_registration": bool, "invite_code_required": bool, "has_admin": bool}` |
| `POST /api/v1/auth/register` | `{"username", "password", "invite_code"?}` | `{"access_token", "token_type": "bearer", "user": UserOut}` |
| `POST /api/v1/auth/login` | `{"username", "password"}` | 同上 |
| `GET /api/v1/auth/me` | 无 | `{"id", "username", "role": "admin"\|"user", "is_active", "created_at"}` |
| `GET /api/v1/admin/settings` | 仅 admin | `{"allow_registration": bool, "invite_code": str, "max_upload_mb": int}` |
| `PATCH /api/v1/admin/settings` | 任意子集 `{allow_registration, invite_code, max_upload_mb}` | 同上 |
| `GET /api/v1/admin/users` | 仅 admin | `UserOut[]` |
| `PATCH /api/v1/admin/users/{user_id}` | `{is_active?, role?}` | `UserOut` |

### 4.2 网文书架、分卷、卷纲、别名与设定本 (`/api/v1/books`)

| 方法 & 路径 | 请求体 / 参数 | 说明与关键字段 |
| :--- | :--- | :--- |
| `GET /api/v1/books` | 无 | 返回 `Book[]`：`id, title, author, total_volumes, total_chapters, total_chars, read_progress_ch, created_at, updated_at` |
| `POST /api/v1/books` | `multipart/form-data`: `file` (`.txt`/`.epub`), `title?`, `author?` | 入库解析原书分卷与章节，返回 `Book` |
| `GET /api/v1/books/{id}` | 无 | 返回 `Book` + `alias_count`, `wiki_count` |
| `DELETE /api/v1/books/{id}` | 无 | 删除书籍、FTS5 索引及关联对话 |
| `POST /api/v1/books/{id}/append` | `multipart/form-data`: `file` | 连载增量追更，返回 `{"appended_chapters", "new_total_chapters", "book"}` |
| `PATCH /api/v1/books/{id}/settings` | `{title?, author?, read_progress_ch?}` | 更新防剧透章号 `read_progress_ch` 或书名作者 |
| `GET /api/v1/books/{id}/volumes` | 无 | 返回原书分卷列表：`id, volume_num, title, start_chapter, end_chapter, summary_status, summary_locked, summary_md, summary_progress`（若 `end_chapter > read_progress_ch`，`summary_locked=true` 且 `summary_md=""`） |
| `POST /api/v1/books/{id}/volumes/split` | `{"volumes": [{"title", "start_chapter", "end_chapter"}]}` | 无分卷小说手动切分卷界（需连续覆盖 `1..total_chapters`） |
| `POST /api/v1/books/{id}/volumes/{vid}/summarize` | `{provider_id?}` | 异步触发单卷卷纲生成 |
| `POST /api/v1/books/{id}/volumes/summarize-all` | `{provider_id?}` | 异步队列生成所有未就绪卷纲 |
| `POST /api/v1/books/{id}/volumes/summarize-pause` | 无 | 请求暂停队列（已完成的段落会断点保留） |
| `GET /api/v1/books/{id}/volumes/summarize-status` | 无 | 轮询：`{"running": bool, "volumes": [...]}` |
| `GET /api/v1/books/{id}/chapters` | `?volume_id=&page=1&page_size=50` | 分页返回章节目录 `{total, page, page_size, items}` |
| `GET /api/v1/books/{id}/chapters/{num}` | `?highlight=关键词` | 返回章节正文 + `highlight_positions: [{"start", "end"}]` |
| `GET /api/v1/books/{id}/aliases` | 无 | 别名列表 `[{id, canonical_name, aliases: string[]}]` |
| `POST /api/v1/books/{id}/aliases` | `{"canonical_name", "aliases": string[], "reindex": true}` | 新增/更新别名并可选重编 FTS5 索引 |
| `DELETE /api/v1/books/{id}/aliases/{aid}` | 无 | 删除别名组 |
| `POST /api/v1/books/{id}/aliases/reindex` | 无 | 手动全书重编 FTS5 索引 |
| `GET /api/v1/books/{id}/wiki` | 无 | 设定卡列表 `[{id, entity_name, category, content_md, source_chapters, updated_at}]` |
| `POST /api/v1/books/{id}/wiki` | `{"entity_name", "category", "content_md", "source_chapters": int[]}` | 创建/更新设定卡 |
| `DELETE /api/v1/books/{id}/wiki/{wid}` | 无 | 删除设定卡 |

### 4.3 日常文档 (`/api/v1/docs`)

| 方法 & 路径 | 请求体 / 参数 | 说明与关键字段 |
| :--- | :--- | :--- |
| `GET /api/v1/docs` | 无 | 文档列表：`id, filename, file_type, total_pages, total_chars, has_scanned_pages, scanned_page_count, retrieval_mode ("direct"\|"paginated_fts"), created_at` |
| `POST /api/v1/docs` | `multipart/form-data`: `file` (`.pdf`/`.pptx`/`.docx`/`.md`/`.txt`) | 解析分页并检测疑似扫描页，返回文档对象 |
| `GET /api/v1/docs/{id}` | 无 | 文档详情 + `pages_outline: [{page_num, heading, char_count, text_density, is_scanned_suspect}]` |
| `DELETE /api/v1/docs/{id}` | 无 | 删除文档及关联对话 |
| `GET /api/v1/docs/{id}/pages/{page_num}` | 无 | 获取指定页正文与密度信息 |

> 当 `has_scanned_pages === true` 时，建议前端在文档顶部展示温和提示条：「检测到 `{scanned_page_count}` 页疑似扫描图/纯图页，当前版本仅解析纯文字（视觉识图将在后续版本开放）」。

### 4.4 模型与中转站 (`/api/v1/providers`)

| 方法 & 路径 | 请求体 | 说明 |
| :--- | :--- | :--- |
| `GET /api/v1/providers/presets` | 无 | 厂商预设模板列表（DeepSeek / OpenAI / Anthropic / Gemini / SiliconFlow / OpenRouter / Qwen / Custom Relay） |
| `GET /api/v1/providers` | 无 | 当前用户模型配置列表（`api_key_masked` 仅回显末尾 4 位） |
| `POST /api/v1/providers` | `{name, protocol, base_url, api_key, model_name, is_default?, supports_tools?, use_react_fallback?}` | 加密保存配置 |
| `PATCH /api/v1/providers/{id}` | 任意上述字段 | 更新配置 |
| `DELETE /api/v1/providers/{id}` | 无 | 删除配置 |
| `POST /api/v1/providers/fetch-models` | `{provider_id}` 或 `{protocol, base_url, api_key}` | 拉取 `{"models": string[]}` |
| `POST /api/v1/providers/test` | `{provider_id}` 或 `{protocol, base_url, api_key, model_name}` | 返回 `{"connectivity_ok", "latency_ms", "supports_tools", "recommended_react_fallback", "detail"}` |

### 4.5 对话与 SSE 流式问答 (`/api/v1/chat`)

- `GET /api/v1/chat/sessions?mode=novel&target_id=1` -> 会话列表
- `PATCH /api/v1/chat/sessions/{id}` (`{"title"}`) / `DELETE /api/v1/chat/sessions/{id}`
- `GET /api/v1/chat/sessions/{id}/messages` -> 历史消息列表（含 `tool_trace`, `citations`）
- `POST /api/v1/chat/stream`
  - 请求体：
    ```json
    {
      "mode": "novel",
      "target_id": 1,
      "message": "陈曦什么时候开始推行摊丁入亩的？",
      "session_id": null,
      "provider_id": null,
      "max_chapter": 4500
    }
    ```
  - 响应：`Content-Type: text/event-stream`，需使用 `fetch` + `ReadableStream`（勿用 `EventSource`，因需要 `POST` + `Authorization` 头）。
  - SSE 事件序列：
    1. `event: session` -> `data: {"session_id": 12}`
    2. `event: tool_start` -> `data: {"round": 1, "tool": "get_keyword_timeline", "arguments": {...}}`
    3. `event: tool_done` -> `data: {"round": 1, "tool": "get_keyword_timeline", "result_chars": 420, "total_tool_chars": 420}`
    4. `event: delta` -> `data: {"text": "增量文本..."}`
    5. `event: citations` -> `data: {"citations": [{"type": "chapter", "chapter_num": 120, "title": "...", "volume_num": 2, "volume_title": "..."}]}`（文档模式为 `{"type": "page", "page_num": 3, "heading": "...", "is_scanned_suspect": false}`）
    6. `event: done` -> `data: {"session_id": 12, "message_id": 88}`
    7. 异常时：`event: error` -> `data: {"detail": "..."}`
