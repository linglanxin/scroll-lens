import {
  ArrowLeft,
  BookOpen,
  FileText,
  History,
  LogOut,
  Moon,
  PanelRight,
  Settings,
  Sun,
} from "lucide-react";
import { useAppStore } from "../../stores/appStore";
import { useAuthStore } from "../../stores/authStore";
import { BrandLogo } from "../common/BrandLogo";

export function TopBar() {
  const {
    mode,
    setMode,
    activeView,
    setActiveView,
    mobileView,
    setMobileView,
    books,
    docs,
    selectedBookId,
    selectedDocId,
    theme,
    toggleTheme,
    setMobileSidebarOpen,
    rightPanelOpen,
    setRightPanelOpen,
  } = useAppStore();
  const { user, logout } = useAuthStore();

  const activeBook = books.find((b) => b.id === selectedBookId) ?? null;
  const activeDoc = docs.find((d) => d.id === selectedDocId) ?? null;
  const currentTitle =
    mode === "novel"
      ? (activeBook?.title ?? "未选择书籍")
      : (activeDoc?.filename ?? "未选择文档");

  return (
    <header className="shrink-0 border-b border-line bg-surface">
      {/* ===== Mobile TopBar (< md): Separated Bookshelf / Book Workspace / Settings ===== */}
      <div className="flex h-12 items-center justify-between gap-1.5 px-2 md:hidden">
        {activeView === "settings" ? (
          <>
            <div className="flex items-center gap-1 min-w-0">
              <button
                type="button"
                onClick={() => setActiveView("workspace")}
                className="inline-flex h-10 items-center gap-1 rounded-xl px-2 text-xs font-medium text-ink hover:bg-hover shrink-0"
                aria-label="返回"
              >
                <ArrowLeft className="h-4 w-4 shrink-0" />
                <span>返回</span>
              </button>
              <span className="truncate text-sm font-semibold text-ink">设置</span>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={toggleTheme}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-ink-secondary hover:bg-hover hover:text-ink"
                aria-label="切换主题"
              >
                {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={logout}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-ink-secondary hover:bg-hover hover:text-danger"
                aria-label="退出登录"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </>
        ) : mobileView === "shelf" ? (
          <>
            <div className="flex items-center gap-2 min-w-0">
              <div className="flex shrink-0 items-center px-1">
                <BrandLogo size="sm" />
              </div>
              <div className="flex shrink-0 items-center rounded-xl border border-line bg-elevated p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setMode("novel")}
                  className={`flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 font-medium ${
                    mode === "novel"
                      ? "bg-surface text-ink shadow-sm"
                      : "text-ink-secondary"
                  }`}
                >
                  <BookOpen className="h-3.5 w-3.5 shrink-0" />
                  <span>网文</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMode("document")}
                  className={`flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 font-medium ${
                    mode === "document"
                      ? "bg-surface text-ink shadow-sm"
                      : "text-ink-secondary"
                  }`}
                >
                  <FileText className="h-3.5 w-3.5 shrink-0" />
                  <span>文档</span>
                </button>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={toggleTheme}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-ink-secondary hover:bg-hover hover:text-ink"
                aria-label="切换主题"
              >
                {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={() => setActiveView("settings")}
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-ink-secondary hover:bg-hover hover:text-ink"
                aria-label="模型与系统设置"
              >
                <Settings className="h-4 w-4" />
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-1 min-w-0 flex-1">
              <button
                type="button"
                onClick={() => setMobileView("shelf")}
                className="inline-flex h-10 shrink-0 items-center gap-1 rounded-xl px-2 text-xs font-medium text-ink-secondary hover:bg-hover hover:text-ink"
                aria-label="返回书架"
              >
                <ArrowLeft className="h-4 w-4 shrink-0" />
                <span className="whitespace-nowrap">书架</span>
              </button>
              <span className="truncate text-sm font-semibold text-ink">
                {currentTitle}
              </span>
            </div>

            <div className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                onClick={() => setMobileSidebarOpen(true)}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-ink-secondary hover:bg-hover hover:text-ink"
                title="历史对话与切换书籍"
                aria-label="打开侧边栏"
              >
                <History className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setRightPanelOpen(!rightPanelOpen)}
                className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                  rightPanelOpen
                    ? "bg-accent-soft text-accent"
                    : "text-ink-secondary hover:bg-hover hover:text-ink"
                }`}
                title="查阅分卷、原文、别名与设定"
                aria-label="切换右侧面板"
              >
                <PanelRight className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setActiveView("settings")}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-ink-secondary hover:bg-hover hover:text-ink"
                aria-label="模型与系统设置"
              >
                <Settings className="h-4 w-4" />
              </button>
            </div>
          </>
        )}
      </div>

      {/* ===== Desktop PC TopBar (>= md): Full 3-column workbench controls ===== */}
      <div className="hidden md:flex h-12 items-center justify-between px-4 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={() => setActiveView("workspace")}
            className="sl-btn flex shrink-0 items-center rounded-xl px-1.5 py-1 hover:bg-hover"
            aria-label="ScrollLens 卷镜"
          >
            <BrandLogo size="sm" showWordmark />
          </button>

          {activeView === "workspace" && (
            <div className="ml-1 flex shrink-0 items-center rounded-xl border border-line bg-elevated p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setMode("novel")}
                className={`sl-btn flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 font-medium ${
                  mode === "novel"
                    ? "bg-surface text-ink shadow-sm"
                    : "text-ink-secondary hover:text-ink"
                }`}
              >
                <BookOpen className="h-3.5 w-3.5 shrink-0" />
                <span>网文</span>
              </button>
              <button
                type="button"
                onClick={() => setMode("document")}
                className={`sl-btn flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 font-medium ${
                  mode === "document"
                    ? "bg-surface text-ink shadow-sm"
                    : "text-ink-secondary hover:text-ink"
                }`}
              >
                <FileText className="h-3.5 w-3.5 shrink-0" />
                <span>文档</span>
              </button>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {activeView === "workspace" && (
            <button
              type="button"
              onClick={() => setRightPanelOpen(!rightPanelOpen)}
              className={`sl-btn inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                rightPanelOpen
                  ? "bg-accent-soft text-accent"
                  : "text-ink-secondary hover:bg-hover hover:text-ink"
              }`}
              title="切换右侧查阅面板"
              aria-label="切换右侧面板"
            >
              <PanelRight className="h-4 w-4" />
            </button>
          )}

          <button
            type="button"
            onClick={toggleTheme}
            className="sl-btn inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-ink-secondary hover:bg-hover hover:text-ink"
            title={theme === "light" ? "切换夜读深色主题" : "切换纸墨浅色主题"}
            aria-label="切换主题"
          >
            {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
          </button>

          <button
            type="button"
            onClick={() =>
              setActiveView(activeView === "settings" ? "workspace" : "settings")
            }
            className={`sl-btn inline-flex h-9 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-2.5 text-xs font-medium ${
              activeView === "settings"
                ? "bg-accent text-accent-fg"
                : "text-ink-secondary hover:bg-hover hover:text-ink"
            }`}
            title="模型与系统设置"
            aria-label="模型与系统设置"
          >
            <Settings className="h-4 w-4 shrink-0" />
            <span>设置</span>
          </button>

          <button
            type="button"
            onClick={logout}
            className="sl-btn inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-ink-secondary hover:bg-hover hover:text-danger"
            title={`退出登录 (${user?.username ?? ""})`}
            aria-label="退出登录"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
  );
}
