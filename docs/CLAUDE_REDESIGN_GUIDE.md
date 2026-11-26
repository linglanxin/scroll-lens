# ScrollLens 前端视觉重塑指南（给 Claude Opus）

前端的功能骨架、TypeScript 类型、API 请求封装、SSE 流式解析与 Zustand 状态流**已全部写完并跑通编译**。本指南专为协助 **Claude Opus** 用最少额度完成最高水准的 UI/UX 视觉打磨而编写。

---

## 1. 严格禁区（绝对不要改动的文件）

以下目录和文件已与后端逐项核对锁定，**改外观时完全不需要读取或修改它们**，可大幅节省上下文与额度：

- `frontend/src/types/api.ts` — 后端接口 DTO 类型定义
- `frontend/src/api/*` — REST 请求、JWT 注入与 SSE 流式解析器
- `frontend/src/stores/*` — `authStore`、`appStore`、`chatStore`、`readerStore` 状态管理

## 2. 你可以自由重塑的区域

- `frontend/src/styles/tokens.css` & `frontend/tailwind.config.js` — 耦合语义视觉主题变量（浅色护眼纸感 / 深色墨夜主题、字体、圆角、阴影层级）
- `frontend/src/index.css` — 排版细节、滚动条、Markdown 阅读样式（`.sl-prose`）
- `frontend/src/components/**` — 全部视觉组件（`TopBar`、`LeftSidebar`、`ChatArea`、`NovelRightPanel`、`DocumentRightPanel`）
- `frontend/src/pages/**` — `AuthPage`、`WorkspacePage`、`SettingsPage`

> **务必保留的功能钩子**（重塑 DOM/样式时不要删掉逻辑绑定）：
> 1. `window.ScrollLensApp?.openServerConfig()`（在 `SettingsPage` 中检测存在时显示“切换/配置服务器地址”按钮，供安卓套壳 APK 使用）。
> 2. `[ch:N]` / `[p:N]` 点击跳转阅读器（`openChapter` / `openDocPage`）。
> 3. 防剧透进度滑块与输入框（`updateReadProgress`）及超进度卷纲锁定态（`vol.summary_locked`）。
> 4. 文档疑似扫描页提示条（`has_scanned_pages`）。

## 3. 推荐的省额度分步打磨节奏（参考 Vibe Coding UI 三阶段法）

1. **阶段 1：先锁定主题 Token 与核心工作台**
   - 先改 `src/styles/tokens.css` 与 `WorkspacePage` + `TopBar` + `LeftSidebar` + `ChatArea`。
   - 建立一套克制、耐读的「卷轴编辑室 / NotebookLM」视觉质感（柔和纸白底色、清晰层次边界、优雅的 `[ch:N]` 引用胶囊与折叠检索轨迹胶囊）。
2. **阶段 2：将样板视觉语言扩散到其余页面与面板**
   - 按阶段 1 确立的卡片、输入框、按钮、间距体系，统一打磨 `NovelRightPanel`、`DocumentRightPanel`、`AuthPage`、`SettingsPage`。
3. **阶段 3：真实边界与移动端验收**
   - 验证超长中文书名/章名截断（`truncate`）、长 Markdown 表格横向滚动、深浅双主题对比度，以及 `375px` 手机竖屏抽屉手感。

---

## 4. 可直接复制发给 Claude Opus 的提示词

```text
请帮我打磨 ScrollLens（卷镜）的前端视觉审美与交互质感。项目位于 frontend/，目前已有一套 100% 功能可用的 React + Vite + Tailwind + Zustand 骨架。

请严格遵守以下规则以节省上下文并保证零回归：
1. 绝对不要读取或修改 frontend/src/types/、frontend/src/api/、frontend/src/stores/。
2. 所有视觉改造集中在 frontend/src/styles/tokens.css、frontend/tailwind.config.js、frontend/src/index.css、frontend/src/components/ 和 frontend/src/pages/。
3. 必须保留所有现有功能绑定（含防剧透滑块、[ch:N]/[p:N] 点击阅读、卷纲轮询与暂停、扫描页提示条、以及 window.ScrollLensApp?.openServerConfig 安卓桥接按钮）。

审美参考方向（结构看参考 1，排版/卡片看参考 2，主题 Token 联动看 tokens.css）：
- 整体借鉴 NotebookLM（左资料源 + 中对话 + 右原文/设定卡三栏）与 LobeChat 的克制现代感；避免廉价渐变和“AI 模板味”。
- 浅色模式主打温润纸墨阅读感，深色模式主打低眩光夜读感；所有颜色通过 tokens.css 语义变量耦合控制。
- 先帮我重塑阶段 1（tokens.css + TopBar + LeftSidebar + ChatArea + WorkspacePage），改完后执行 npm run build 确保无 TypeScript/打包报错，我确认样式后再继续打磨其余页面。
```
