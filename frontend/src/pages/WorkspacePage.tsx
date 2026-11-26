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
            className="fixed inset-0 bg-black/40"
            onClick={() => setMobileSidebarOpen(false)}
          />
          <div className="relative z-50 h-full">
            <LeftSidebar />
          </div>
        </div>
      )}

      {/* Center Chat Area */}
      <main className="flex flex-1 flex-col min-w-0">
        {actionError && (
          <div className="flex items-center justify-between border-b border-danger/30 bg-danger/10 px-4 py-1.5 text-xs text-danger">
            <span>{actionError}</span>
            <button type="button" onClick={clearActionError} className="underline">
              关闭
            </button>
          </div>
        )}
        <ChatArea />
      </main>

      {/* Desktop Right Panel */}
      {rightPanelOpen && (
        <aside className="hidden lg:flex w-96 shrink-0 flex-col border-l border-line">
          {mode === "novel" ? <NovelRightPanel /> : <DocumentRightPanel />}
        </aside>
      )}

      {/* Mobile/Tablet Right Drawer */}
      {rightPanelOpen && (
        <div className="fixed inset-0 z-40 flex justify-end lg:hidden">
          <div
            className="fixed inset-0 bg-black/40"
            onClick={() => setRightPanelOpen(false)}
          />
          <div className="relative z-50 flex h-full w-full max-w-md flex-col border-l border-line bg-surface shadow-xl">
            <div className="flex items-center justify-between border-b border-line px-3 py-2">
              <span className="text-xs font-semibold text-ink">
                {mode === "novel" ? "卷纲 / 原文 / 别名 / 设定" : "文档页面与大纲"}
              </span>
              <button
                type="button"
                onClick={() => setRightPanelOpen(false)}
                className="rounded p-1 text-ink-secondary hover:bg-hover"
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
