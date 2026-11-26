import {
  BookOpen,
  FileText,
  LogOut,
  Menu,
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
    theme,
    toggleTheme,
    setMobileSidebarOpen,
    rightPanelOpen,
    setRightPanelOpen,
  } = useAppStore();
  const { user, logout } = useAuthStore();

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-line bg-surface px-2.5 sm:px-4 gap-2">
      <div className="flex items-center gap-2 min-w-0">
        {activeView === "workspace" && (
          <button
            type="button"
            onClick={() => setMobileSidebarOpen(true)}
            className="sl-btn inline-flex h-10 w-10 items-center justify-center rounded-xl text-ink-secondary hover:bg-hover hover:text-ink md:hidden"
            title="打开资料与会话抽屉"
            aria-label="打开侧边栏"
          >
            <Menu className="h-5 w-5" />
          </button>
        )}

        <button
          type="button"
          onClick={() => setActiveView("workspace")}
          className="sl-btn flex items-center rounded-xl px-1.5 py-1 hover:bg-hover"
        >
          <BrandLogo size="sm" showWordmark />
        </button>

        {activeView === "workspace" && (
          <div className="ml-1 flex items-center rounded-xl border border-line bg-elevated p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setMode("novel")}
              className={`sl-btn flex h-7 items-center gap-1.5 rounded-lg px-2.5 font-medium ${
                mode === "novel"
                  ? "bg-surface text-ink shadow-sm"
                  : "text-ink-secondary hover:text-ink"
              }`}
            >
              <BookOpen className="h-3.5 w-3.5" />
              <span>网文</span>
            </button>
            <button
              type="button"
              onClick={() => setMode("document")}
              className={`sl-btn flex h-7 items-center gap-1.5 rounded-lg px-2.5 font-medium ${
                mode === "document"
                  ? "bg-surface text-ink shadow-sm"
                  : "text-ink-secondary hover:text-ink"
              }`}
            >
              <FileText className="h-3.5 w-3.5" />
              <span>文档</span>
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1">
        {activeView === "workspace" && (
          <button
            type="button"
            onClick={() => setRightPanelOpen(!rightPanelOpen)}
            className={`sl-btn inline-flex h-9 w-9 items-center justify-center rounded-xl ${
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
          className="sl-btn inline-flex h-9 w-9 items-center justify-center rounded-xl text-ink-secondary hover:bg-hover hover:text-ink"
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
          className={`sl-btn inline-flex h-9 items-center gap-1.5 rounded-xl px-2.5 text-xs font-medium ${
            activeView === "settings"
              ? "bg-accent text-accent-fg"
              : "text-ink-secondary hover:bg-hover hover:text-ink"
          }`}
          title="模型与系统设置"
        >
          <Settings className="h-4 w-4" />
          <span className="hidden sm:inline">设置</span>
        </button>

        <button
          type="button"
          onClick={logout}
          className="sl-btn inline-flex h-9 w-9 items-center justify-center rounded-xl text-ink-secondary hover:bg-hover hover:text-danger"
          title={`退出登录 (${user?.username ?? ""})`}
          aria-label="退出登录"
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
