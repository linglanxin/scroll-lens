import { useEffect } from "react";
import { X } from "lucide-react";
import { LeftSidebar } from "../components/layout/LeftSidebar";
import { ChatArea } from "../components/chat/ChatArea";
import { NovelRightPanel } from "../components/novel/NovelRightPanel";
import { DocumentRightPanel } from "../components/document/DocumentRightPanel";
import { useAppStore } from "../stores/appStore";
import { useChatStore } from "../stores/chatStore";

export function WorkspacePage() {
  const {
    mode,
    selectedBookId,
    selectedDocId,
    mobileSidebarOpen,
    setMobileSidebarOpen,
    rightPanelOpen,
    setRightPanelOpen,
    actionError,
    clearActionError,
  } = useAppStore();

  const { loadSessions } = useChatStore();

  const targetId = mode === "novel" ? selectedBookId : selectedDocId;

  useEffect(() => {
    void loadSessions(mode, targetId);
  }, [mode, targetId, loadSessions]);

  return (
    <div className="relative flex flex-1 min-h-0 overflow-hidden">
      {/* Desktop Left Sidebar */}
      <div className="hidden md:flex shrink-0">
        <LeftSidebar />
      </div>

      {/* Mobile Left Drawer */}
      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <div
            className="sl-animate-fade fixed inset-0 bg-black/45"
            onClick={() => setMobileSidebarOpen(false)}
          />
          <div className="sl-animate-drawer-left relative z-50 h-full">
            <LeftSidebar />
          </div>
        </div>
      )}

      {/* Center Chat Stage */}
      <main className="flex flex-1 flex-col min-w-0 min-h-0">
        {actionError && (
          <div className="flex items-center justify-between border-b border-danger/30 bg-danger/10 px-4 py-1.5 text-xs text-danger shrink-0">
            <span className="truncate">{actionError}</span>
            <button type="button" onClick={clearActionError} className="ml-2 shrink-0 underline">
              关闭
            </button>
          </div>
        )}
        <ChatArea />
      </main>

      {/* Desktop Right Inspector */}
      {rightPanelOpen && (
        <aside className="hidden lg:flex w-[380px] xl:w-[410px] shrink-0 flex-col border-l border-line min-h-0">
          {mode === "novel" ? <NovelRightPanel /> : <DocumentRightPanel />}
        </aside>
      )}

      {/* Mobile & Tablet Right Sheet */}
      {rightPanelOpen && (
        <div className="fixed inset-0 z-40 flex justify-end lg:hidden">
          <div
            className="sl-animate-fade fixed inset-0 bg-black/45"
            onClick={() => setRightPanelOpen(false)}
          />
          <div className="sl-animate-drawer-right relative z-50 flex h-full w-full max-w-md flex-col border-l border-line bg-surface shadow-xl">
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-line px-3.5">
              <span className="text-xs font-semibold text-ink">
                {mode === "novel" ? "卷纲 · 原文 · 别名 · 设定" : "文档大纲与页码正文"}
              </span>
              <button
                type="button"
                onClick={() => setRightPanelOpen(false)}
                className="sl-btn inline-flex h-9 w-9 items-center justify-center rounded-xl text-ink-secondary hover:bg-hover"
                aria-label="关闭右侧面板"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 min-h-0">
              {mode === "novel" ? <NovelRightPanel /> : <DocumentRightPanel />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
