# ScrollLens 手机端与安卓壳适配改造方案

> **状态**：规划定稿（待实施）  
> **实机测试基线**：Android 16（API 36）· `medium_phone`（1080×2400 / 411dp 逻辑宽）· WebView 133  
> **测试与采集环境**：`F:\安卓模拟器`（Android CLI + Android SDK + `openatx/uiautomator2` + `mobile-dev-inc/Maestro` + `openatx/uiautodev` + `Genymobile/scrcpy` + `@mobilenext/mobile-mcp` + `ai_monitor.py` 实时触控与日志采集）

---

## 一、GitHub 开源项目架构参考

本方案对照以下 GitHub 主流安卓与混合应用开源实践设计，确保改动符合现代 Android 15/16 规范而非临时补丁：

| 开源项目 | GitHub 仓库 | 本项目借鉴的核心实践 |
| :--- | :--- | :--- |
| **Capacitor** | [ionic-team/capacitor](https://github.com/ionic-team/capacitor) | Android 15/16 Edge-to-Edge 适配（`WindowInsetsControllerCompat` 同步亮暗状态栏/导航栏）、`viewport-fit=cover` + `env(safe-area-inset-*)`、JS Bridge 协同处理硬件返回键（`backButton` 优先级链） |
| **Now in Android** | [android/nowinandroid](https://github.com/android/nowinandroid) | Google 官方 Material 3 移动端规范：最小 44–48dp 触控热区、顶部/底部系统栏安全区隔离、移动端信息层级精简 |
| **Android NestedScroll WebView** | [Telefonica/android-nested-scroll-webview](https://github.com/Telefonica/android-nested-scroll-webview) | 解决 `SwipeRefreshLayout` 与 WebView 内部容器滚动冲突；明确 **SPA（`100dvh` + `overflow: hidden`）场景不应外包原生 `SwipeRefreshLayout`**，应改为应用内按需局部刷新 |
| **Maestro** | [mobile-dev-inc/Maestro](https://github.com/mobile-dev-inc/Maestro) | 声明式 YAML 端到端 UI 回归测试，改造后沉淀核心手机端交互回归用例 |
| **uiautomator2 / uiautodev** | [openatx/uiautomator2](https://github.com/openatx/uiautomator2) / [openatx/uiautodev](https://github.com/openatx/uiautodev) | 毫秒级控件树坐标碰撞检测、拟人滑屏与中文输入实机验收 |

---

## 二、实机全链路排查发现的问题总览（13 项）

### P0｜严重阻断与核心交互冲突

#### P0-1. 顶部导航栏按钮严重重叠与文字竖排折行（「文档」模式无法点击）
- **实机现象**：411dp 屏宽下，`TopBar` 内横排塞了 8 个交互项，导致：
  - `文档` 按钮坐标 `[616, 86, 756, 162]` 与 `切换右侧面板` 按钮 `[645, 76, 742, 173]` **直接重叠**，点「文档」中心 `(686, 124)` 反而打开右侧面板；
  - `卷镜`、`网文`、`文档` 全部被迫竖排折成两行；
  - 左上角汉堡菜单宽度被压缩至 `58px`（≈22dp），难以点击。
- **涉及源码**：
  - `frontend/src/components/layout/TopBar.tsx`（L30–L135）
  - `frontend/src/components/common/BrandLogo.tsx`（L43–L57）
- **改造方案**：
  1. **移动端（`< md`）精简顶栏为 4 个固定区块**（单行 `h-12`，所有文本强制 `whitespace-nowrap shrink-0`）：
     - 左：`44×44px` 汉堡菜单（`shrink-0`）+ 紧凑 `BrandLogo`（手机端隐藏中文副标「卷镜」或仅显示图标，留足水平空间）；
     - 中：「网文 / 文档」分段切换器（`shrink-0 whitespace-nowrap`）；
     - 右：仅保留高频的 **「查阅面板」图标**（`40×40px`）与 **「设置」图标**（`40×40px`）。
  2. 将低频项 **「切换深/浅主题」「退出登录」「切换服务器地址」** 收纳至左侧抽屉底部或设置页顶部（桌面端 `>= md` 保持原样全部展示）。
  3. 验收红线：411dp 与 360dp 屏宽下顶栏任意两个按钮**零重叠**、所有文字**零换行**、所有按钮热区 `>= 40px`。

#### P0-2. 手机端启动或刷新后自动弹出「分卷/卷纲」全屏抽屉
- **实机现象**：冷启动进入 App 或页面 reload 后，直接盖满一层「卷纲 · 原文 · 别名 · 设定」抽屉，挡住聊天主界面。
- **涉及源码**：
  - `frontend/src/stores/appStore.ts`（L78：`rightPanelOpen: true`）
- **改造方案**：
  - 按视口宽度计算默认初始值：
    ```ts
    function getInitialRightPanelOpen(): boolean {
      return typeof window !== "undefined" ? window.innerWidth >= 1024 : false;
    }
    ```
  - 手机/平板（`< lg`）默认收起右侧抽屉，用户仅在点击「查阅面板」或点击答案中的 `[ch:N]` / `[p:N]` 溯源标签时主动展开。

#### P0-3. 安卓原生「下拉刷新」劫持页面内一切下滑手势，且刷新跳回初始状态
- **实机现象**：在聊天记录区、原文阅读器、分卷列表、设置页中，只要手指**向下滑（回看前文/历史消息）**，立刻触发原生 `SwipeRefreshLayout` 整页 reload，丢失当前滚动位置、阅读章节并重新弹出分卷抽屉。
- **涉及源码**：
  - `android-shell/app/src/main/res/layout/activity_main.xml`（L8–L17）
  - `android-shell/app/src/main/java/io/github/scrolllens/app/MainActivity.kt`（L180–L182）
  - `frontend/src/index.css`（L7–L15：`html, body, #root { height: 100dvh; overflow: hidden; }`）
- **改造方案**：
  - **直接移除或默认禁用 `MainActivity` 中的 `SwipeRefreshLayout`**（不再对 `WebView` 监听全局下拉手势，彻底归还纵向滚动权给 Web 内部容器）。
  - 如需手动重载页面，可在「设置页」或断网错误页保留显式「重新加载 / 重试」按钮；书架/会话数据更新走前端 API 局部刷新而非 `webView.reload()`。

#### P0-4. 安卓系统「返回键 / 侧滑返回手势」无法关闭抽屉与退出设置页
- **实机现象**：打开左侧书架抽屉、右侧查阅抽屉或设置页后，按安卓返回键页面无任何反应，连按两次会直接退出 App。
- **涉及源码**：
  - `android-shell/app/src/main/java/io/github/scrolllens/app/MainActivity.kt`（L195–L215）
  - `frontend/src/App.tsx`、`frontend/src/pages/WorkspacePage.tsx`、`frontend/src/stores/appStore.ts`
- **改造方案（参考 Capacitor `backButton` 模式）**：
  1. 在前端 `App.tsx` 挂载全局返回处理器 `window.__scrollLensHandleBack = () => boolean`，按以下优先级逐层消费返回事件并返回 `true`：
     - 若 PromptBar 的快捷指令面板 / 防剧透进度锁气泡处于打开态 → 关闭气泡；
     - 若 `mobileSidebarOpen === true` → 关闭左侧书架抽屉；
     - 若 `rightPanelOpen === true`（移动端 `< 1024px`）→ 关闭右侧查阅抽屉；
     - 若 `activeView === "settings"` → 切回 `"workspace"`；
     - 均未打开则返回 `false`。
  2. 在 `MainActivity.kt` 的 `OnBackPressedCallback` 中先通过 `webView.evaluateJavascript("window.__scrollLensHandleBack ? window.__scrollLensHandleBack() : false")` 询问前端：
     - 返回 `"true"` → 已消费，不退出；
     - 返回 `"false"` → 再走 `if (webView.canGoBack()) webView.goBack()` → 否则触发“2 秒内再按一次返回键退出”。

#### P0-5. 首次无服务器配置启动 App 时重复拉起两个 `ServerConfigActivity`
- **实机现象**：首次配置服务器点「保存并进入」后，关闭顶层配置页下面还叠着一个重复的配置页。
- **涉及源码**：
  - `android-shell/app/src/main/java/io/github/scrolllens/app/MainActivity.kt`（L81–L99）
- **改造方案**：
  - 在 `MainActivity.kt` 增加 `private var serverConfigLaunched = false` 守卫（或统一由 `onResume()` 检查 `if (active == null && !serverConfigLaunched)` 并使用 `ActivityResultLauncher` 重置标志），保证只弹出单个 `ServerConfigActivity`。

---

### P1｜移动端布局裁切、系统栏主题与触控体验

#### P1-6. 「防剧透进度锁」气泡右侧贴边越界
- **实机现象**：点击 `第 X / Y 章` 后弹出的 `w-72` 滑块卡片贴死并裁切出 411dp 屏幕右侧。
- **涉及源码**：`frontend/src/components/chat/PromptBar.tsx`（L275–L328）
- **改造方案**：将 `spoilerPopover` 的定位容器上移至 PromptBar 外层或改为移动端 `fixed`/`absolute inset-x-2 sm:inset-x-auto sm:left-0 sm:w-72`，确保左右至少保留 `8–12px` 边距，滑块与数字输入框操作更宽敞。

#### P1-7. 深色夜读模式下安卓顶部状态栏与底部导航栏保持刺眼纯白
- **实机现象**：前端切换深色主题后，顶部状态栏和底部系统手势条仍为白底黑字。
- **涉及源码**：
  - `android-shell/app/src/main/res/values/themes.xml`（L6–L7）
  - `android-shell/app/src/main/java/io/github/scrolllens/app/ScrollLensBridge.kt`
  - `frontend/src/stores/appStore.ts`（L19–L24、L97–L102）
  - `frontend/index.html`（检查并确保 `viewport-fit=cover`）
- **改造方案（参考 Capacitor `@capacitor/system-bars`）**：
  1. 在 `ScrollLensBridge` 新增 `@JavascriptInterface fun setSystemTheme(isDark: Boolean)`；
  2. 在 `MainActivity` 主线程使用 `WindowInsetsControllerCompat(window, window.decorView)` 同步设置：
     - `isAppearanceLightStatusBars = !isDark`
     - `isAppearanceLightNavigationBars = !isDark`
     - 同步切换 `window.statusBarColor` 与 `window.navigationBarColor`（浅色 `#FAF9F7` / 深色 `#111318`，与 `tokens.css` 的 `--bg-surface` 对齐）。
  3. 前端 `loadInitialTheme()` 与 `toggleTheme()` 时调用 `window.ScrollLensApp?.setSystemTheme?.(theme === "dark")`。

#### P1-8. 底部安全区留白不足导致列表底项与输入框被手势条裁切
- **实机现象**：分卷列表底项（`第十卷...`）和设置页底部「单文件上传上限 (MB)」输入框被底部手势导航条截断。
- **涉及源码**：
  - `frontend/src/components/novel/NovelRightPanel.tsx`（L199）
  - `frontend/src/components/document/DocumentRightPanel.tsx`
  - `frontend/src/pages/SettingsPage.tsx`（L159）
  - `frontend/src/components/chat/PromptBar.tsx`（底部容器）
- **改造方案**：统一为所有主滚动区域底部追加安全留白类（如 `pb-[calc(1.5rem+env(safe-area-inset-bottom))]`），PromptBar 外层容器增加适度底部间距。

#### P1-9. 触控热区偏小与危险操作（删除）无确认保护
- **实机现象**：
  - 左侧书架书籍卡片的「追更」「删除」与会话「删除」图标偏小且紧邻，滑动列表时易误触直接删除；
  - 原文阅读器顶栏「上一章 / 下一章」仅 `32×32px`（32dp），且文末没有底部翻章栏；
  - 设置页复选框、模型卡片「自检」「删除」按钮偏小且紧凑。
- **涉及源码**：
  - `frontend/src/components/layout/LeftSidebar.tsx`（L285–L309、L421–L431）
  - `frontend/src/components/novel/NovelRightPanel.tsx`（L364–L390）
  - `frontend/src/pages/SettingsPage.tsx`
- **改造方案**：
  - 移动端核心按钮热区统一提升至 `h-10`（`>= 40px`），图标按钮间距 `>= 8px`；
  - 删除书籍 / 文档 / 模型配置增加轻量化二次确认（如点击变红确认或 `confirm` 弹窗）；
  - 原文阅读器正文末尾新增全宽「上一章 / 下一章」按钮栏，方便单手拇指连续阅读。

#### P1-10. 设置页头部换行散乱与模型选择器文字截断
- **实机现象**：设置页顶部的 `返回工作台`、`标题`、`切换/配置服务器地址` 折成两行显得凌乱；`API Key 服务端对称加密保存` 与标题挤在一行；PromptBar 底部模型下拉框 `DeepSeek · deepse...` 截断严重。
- **涉及源码**：`frontend/src/pages/SettingsPage.tsx`（L161–L220）、`frontend/src/components/chat/PromptBar.tsx`（L422–L448）
- **改造方案**：
  - 设置页头部在移动端采用两层清晰布局（第 1 行：返回 + 标题；第 2 行：安卓专属「切换服务器」通栏按钮），副标题换行至卡片标题下方；
  - PromptBar 底部模型选择器放宽 `max-w`（利用移动端隐藏字数统计后腾出的宽度，如 `flex-1 min-w-0 max-w-[220px]`）。

---

### P2｜细节打磨、桌面文案清理与调试增强

#### P2-11. 清理手机端残留的 PC 桌面交互文案与控件
- **涉及源码**：`PromptBar.tsx`（L230）、`ChatArea.tsx`、`LeftSidebar.tsx`（L242、L317）、`NovelRightPanel.tsx`（设定本 textarea）
- **改造方案**：
  - 快捷指令面板标题在 `< sm` 隐藏键盘按键提示（仅显示「快捷提问模板」）；
  - 拖拽提示（「拖拽到窗口」「可直接拖拽文件到此」）加 `hidden md:inline` 或移动端替换为「点击上传本地小说/文档」；
  - 所有移动端 `<textarea>` 补充 `resize-none`，消除右下角桌面缩放角标。

#### P2-12. 分卷卡片布局与别名/设定空状态补齐
- **涉及源码**：`frontend/src/components/novel/NovelRightPanel.tsx`（L264–L331、L396–L554）
- **改造方案**：
  - 卷卡片在窄屏改为上下结构（第 1 行：完整卷标题 + 章节范围，避免单字孤立折行；第 2 行：右对齐或等宽「读首章」「生成卷纲」按钮）；
  - 「别名表」的 `全书重建` 补齐次级按钮边框；别名表 / 设定本无条目时补充简洁空状态引导卡片。

#### P2-13. Debug 模式开启 WebView 远程调试与软键盘专项复测
- **涉及源码**：`android-shell/app/src/main/java/io/github/scrolllens/app/MainActivity.kt`
- **改造方案**：
  - 在 `configureWebView()` 加入 `if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true)`，支持 `chrome://inspect` 实时审查移动端 DOM/CSS；
  - 验收阶段切换模拟器「显示虚拟键盘」，专项复测 `adjustResize` + `100dvh` 下软键盘弹出时 PromptBar 与消息列表的顶起表现。

---

## 三、分阶段实施路线图

1. **Phase 1 — 阻断修复（P0-1 ~ P0-5）**
   - 安卓壳：移除/禁用 `SwipeRefreshLayout`、修复 `ServerConfigActivity` 双开、接入 `OnBackPressedCallback` → JS 返回桥接、开启 Debug WebView 调试；
   - 前端：重构移动端 `TopBar`、`rightPanelOpen` 按屏宽初始化、实现 `window.__scrollLensHandleBack` 统一关闭抽屉/设置页。
2. **Phase 2 — 移动端原生质感与触控适配（P1-6 ~ P1-10）**
   - 接入原生状态栏/导航栏亮暗主题同步桥接、修复进度锁弹窗越界、补齐全局安全区底部留白、放大触控热区与删除确认、补齐阅读器底部翻章栏与设置页排版。
3. **Phase 3 — 细节打磨与自动化回归（P2-11 ~ P2-13）**
   - 清理移动端桌面文案、优化分卷卡片与空状态、使用 `Maestro` + `ai_android.py` 编写自动化回归用例在 `medium_phone` 上全量实机验证。

---

## 四、改造后真机自动化验收清单

每次改完重新构建 `frontend/dist` 与 `app-debug.apk` 后，在 `medium_phone`（`emulator-5554`）执行以下回归验证：

1. **冷启动验证**：首次无服务器配置仅弹出 1 层配置页；已配置服务器后启动直接进入聊天主界面（右侧抽屉默认关闭）。
2. **坐标碰撞检测（`ai_android.py`）**：411dp 与 360dp 下顶栏按钮 `OVERLAPS == []`，点「文档」中心 100% 切入文档模式。
3. **滚动无劫持验证**：在聊天区、原文阅读器、分卷列表、设置页分别上下大幅滑动，不触发整页 reload 且不意外弹出右侧面板。
4. **返回键栈验证**：依次打开左侧书架 / 右侧面板 / 设置页，按硬件返回键均逐层关闭，最后回到主界面再按才提示退出。
5. **视觉与系统栏验证**：深色模式顶栏/底栏同步暗色；防剧透弹窗不越界；分卷底项与设置页底项不被手势条遮挡；软键盘弹出不遮挡输入框。
6. **Maestro E2E 回归**：在 `F:\安卓模拟器` 下运行 Maestro YAML 测试流校验关键路径。
