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

export function TopBar() {
  const {
    mode,
    setMode,
    activeView,
    setActiveView,
    theme,
    toggleTheme,
    providers,
    selectedProviderId,
    selectProvider,
    setMobileSidebarOpen,
    rightPanelOpen,
    setRightPanelOpen,
  } = useAppStore();
  const { user, logout } = useAuthStore();

  return (
    <header className="flex h-13 shrink-0 items-center justify-between border-b border-line bg-surface px-3 py-2 gap-2">
      <div className="flex items-center gap-2 min-w-0">
        {activeView === "workspace" && (
          <button
            type="button"
            onClick={() => setMobileSidebarOpen(true)}
            className="rounded-lg p-1.5 text-ink-secondary hover:bg-hover md:hidden"
            title="打开侧边栏"
          >
            <Menu className="h-5 w-5" />
          </button>
        )}

        <button
          type="button"
          onClick={() => setActiveView("workspace")}
          className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-hover"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-accent-fg text-xs font-bold">
            卷
          </span>
          <span className="hidden sm:inline font-semibold text-sm text-ink">ScrollLens</span>
        </button>

        {activeView === "workspace" && (
          <div className="flex items-center rounded-lg border border-line bg-elevated p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setMode("novel")}
              className={`flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition ${
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
              className={`flex items-center gap-1 rounded-md px-2.5 py-1 font-medium transition ${
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

      <div className="flex items-center gap-1.5">
        {activeView === "workspace" && (
          <select
            value={selectedProviderId ?? ""}
            onChange={(e) =>
              selectProvider(e.target.value ? Number(e.target.value) : null)
            }
            className="max-w-[150px] sm:max-w-[200px] truncate rounded-lg border border-line bg-elevated px-2 py-1 text-xs text-ink outline-none focus:border-accent"
            title="选择当前对话模型"
          >
            {providers.length === 0 ? (
              <option value="">未配置模型（去设置）</option>
            ) : (
              providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · {p.model_name}
                </option>
              ))
            )}
          </select>
        )}

        {activeView === "workspace" && (
          <button
            type="button"
            onClick={() => setRightPanelOpen(!rightPanelOpen)}
            className={`rounded-lg p-1.5 transition ${
              rightPanelOpen
                ? "bg-accent-soft text-accent"
                : "text-ink-secondary hover:bg-hover"
            }`}
            title="切换右侧辅助面板"
          >
            <PanelRight className="h-4 w-4" />
          </button>
        )}

        <button
          type="button"
          onClick={toggleTheme}
          className="rounded-lg p-1.5 text-ink-secondary hover:bg-hover"
          title={theme === "light" ? "切换深色主题" : "切换浅色主题"}
        >
          {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
        </button>

        <button
          type="button"
          onClick={() =>
            setActiveView(activeView === "settings" ? "workspace" : "settings")
          }
          className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium transition ${
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
          className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs text-ink-secondary hover:bg-hover hover:text-danger"
          title={`退出登录 (${user?.username ?? ""})`}
        >
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
