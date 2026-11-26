# ScrollLens 前端视觉规范与维护指南（Gemini 4 Neon 接管版）

本文件记录已完成并上线的前端设计体系（替代原给 Claude Opus 的外包指引）。今后你在 Antigravity 中使用 **Gemini 4 Neon** 继续维护或迭代前端时，直接遵循本规范即可。

---

## 1. 品牌与图标一致性

- **视觉来源**：[`BrandLogo.tsx`](../frontend/src/components/common/BrandLogo.tsx) 与安卓启动图标 [`ic_launcher_foreground.xml`](../android-shell/app/src/main/res/drawable/ic_launcher_foreground.xml) 保持完全同源（`#1E3A5F` 深墨蓝卷轴底 + 纯白线框卷轴 + `#93C5FD` 晴空蓝透镜）。
- **克制配色体系**（[`tokens.css`](../frontend/src/styles/tokens.css)）：
  - 浅色纸墨主题：`#F8F8F6` 画布 + `#FFFFFF` 卡片 + `#1E3A5F` 主强调色。
  - 深色夜读主题：`#0E0F11` 纯净炭黑画布 + `#15171A` 卡片 + `#93C5FD` 透镜强调色。
  - 禁止紫/靛渐变背景、禁止大面积荧光发光边框与无意义阴影。

## 2. 核心微交互与跨端适配要点

- **React Bits 风格 PromptBar（[`PromptBar.tsx`](../frontend/src/components/chat/PromptBar.tsx)）**：
  - 顶部上下文胶囊：当前书籍/文档 + 可点击弹出的**防剧透进度锁气泡**（滑块与章节输入即时联动）。
  - `/` 快捷指令面板：支持键盘 `↑`/`↓`/`Enter`/`Esc` 导航。
  - 内置快捷文件导入、紧凑模型选择器与弹性发送/停止按钮（`sl-btn` 按压缩放反馈，尊重 `prefers-reduced-motion`）。
- **Windows 桌面端 + 手机/安卓 WebView 适配**：
  - 全屏容器使用 `100dvh` + `env(safe-area-inset-bottom)`，防止安卓软键盘弹出时挤压遮挡输入框。
  - 手机端（`< 768px`）顶部导航栏保持单行 `48px`，模型选择器下沉至 `PromptBar`，左侧书架与右侧查阅面板分别以滑入抽屉呈现。
  - 桌面端（`>= 1024px`）采用三栏布局与细滚动条（`scrollbar-width: thin`）。

## 3. 逻辑与样式隔离红线

迭代 UI 时同样严守分层边界：
- **禁止改动**：`frontend/src/types/`、`frontend/src/api/`、`frontend/src/stores/`（保证 SSE、JWT 与多用户逻辑零回归）。
- **只改视觉层**：`frontend/src/styles/`、`frontend/tailwind.config.js`、`frontend/src/components/`、`frontend/src/pages/`。
- 改完后务必在 `frontend/` 执行 `npm run build`（`tsc --noEmit && vite build`）确认无类型与构建错误。

---

## 4. 后续用 Neon 继续微调 UI 的自用 Prompt 模板

```text
请参照 docs/UI_DESIGN_SYSTEM.md 优化 ScrollLens 的 <具体页面或组件> 视觉与交互体验：
- 严禁修改 frontend/src/types/、frontend/src/api/、frontend/src/stores/。
- 保持 #1E3A5F / #93C5FD 卷镜品牌视觉与 tokens.css 耦合色板。
- 动效仅使用 transform/opacity 并遵守 prefers-reduced-motion，同时兼顾 Windows 桌面与 375px 安卓 WebView 手感。
- 改完后在 frontend/ 执行 npm run build 验证。
```
