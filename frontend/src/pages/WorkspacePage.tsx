import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { BookOpen, CheckCircle2, FileText, Loader2, Upload, X } from "lucide-react";
import { LeftSidebar, type DropNotice } from "../components/layout/LeftSidebar";
import { ChatArea } from "../components/chat/ChatArea";
import { MobileBookshelf } from "../components/mobile/MobileBookshelf";
import { NovelRightPanel } from "../components/novel/NovelRightPanel";
import { DocumentRightPanel } from "../components/document/DocumentRightPanel";
import {
  DOC_FORMAT_BADGES,
  DOC_FORMAT_SUMMARY,
  NOVEL_FORMAT_BADGES,
  NOVEL_FORMAT_SUMMARY,
  hasDraggedFiles,
  isSupportedDocFile,
  isSupportedForMode,
  isSupportedNovelFile,
} from "../components/common/fileFormats";
import { useAppStore } from "../stores/appStore";
import { useChatStore } from "../stores/chatStore";
import type { AppMode } from "../types/api";

export function WorkspacePage() {
  const {
    mode,
    setMode,
    books,
    selectedBookId,
    selectedDocId,
    mobileView,
    mobileSidebarOpen,
    setMobileSidebarOpen,
    rightPanelOpen,
    setRightPanelOpen,
    uploading,
    uploadBook,
    uploadDoc,
    actionError,
    clearActionError,
  } = useAppStore();

  const { loadSessions } = useChatStore();

  const dragDepthRef = useRef(0);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [dropProgress, setDropProgress] = useState<string | null>(null);
  const [dropNotice, setDropNotice] = useState<
    (DropNotice & { suggestMode?: AppMode }) | null
  >(null);

  const targetId = mode === "novel" ? selectedBookId : selectedDocId;

  useEffect(() => {
    void loadSessions(mode, targetId);
  }, [mode, targetId, loadSessions]);

  const resetDragState = useCallback(() => {
    dragDepthRef.current = 0;
    setDraggingFiles(false);
  }, []);

  // Prevent browser from opening dropped files in a new tab if dropped outside handlers
  useEffect(() => {
    const onWindowDragOver = (e: globalThis.DragEvent) => {
      if (hasDraggedFiles(e.dataTransfer)) {
        e.preventDefault();
      }
    };
    const onWindowDrop = (e: globalThis.DragEvent) => {
      if (hasDraggedFiles(e.dataTransfer)) {
        e.preventDefault();
      }
      resetDragState();
    };
    const onWindowDragEnd = () => resetDragState();

    window.addEventListener("dragover", onWindowDragOver);
    window.addEventListener("drop", onWindowDrop);
    window.addEventListener("dragend", onWindowDragEnd);
    return () => {
      window.removeEventListener("dragover", onWindowDragOver);
      window.removeEventListener("drop", onWindowDrop);
      window.removeEventListener("dragend", onWindowDragEnd);
    };
  }, [resetDragState]);

  useEffect(() => {
    if (!dropNotice || dropNotice.kind !== "success") return;
    const timer = window.setTimeout(() => setDropNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [dropNotice]);

  function handleDragEnter(e: DragEvent<HTMLDivElement>) {
    if (!hasDraggedFiles(e.dataTransfer)) return;
    e.preventDefault();
    dragDepthRef.current += 1;
    setDraggingFiles(true);
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    if (!hasDraggedFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    if (!hasDraggedFiles(e.dataTransfer)) return;
    e.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setDraggingFiles(false);
    }
  }

  async function handleWorkspaceDrop(e: DragEvent<HTMLDivElement>) {
    if (!hasDraggedFiles(e.dataTransfer)) return;
    e.preventDefault();
    resetDragState();

    if (uploading) return;
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length === 0) return;

    const validFiles = files.filter((f) => isSupportedForMode(f.name, mode));
    const invalidFiles = files.filter((f) => !isSupportedForMode(f.name, mode));

    if (validFiles.length === 0) {
      const otherMode: AppMode = mode === "novel" ? "document" : "novel";
      const fitsOtherMode = invalidFiles.some((f) =>
        otherMode === "novel" ? isSupportedNovelFile(f.name) : isSupportedDocFile(f.name)
      );
      const names = invalidFiles.map((f) => f.name).join("、");
      setDropNotice({
        kind: "error",
        text: fitsOtherMode
          ? `当前为${mode === "novel" ? "网文" : "日常文档"}模式，不支持直接导入「${names}」，该格式适用于${otherMode === "novel" ? "网文" : "日常文档"}模式。`
          : `不支持的文件格式：「${names}」。当前模式支持：${mode === "novel" ? NOVEL_FORMAT_SUMMARY : DOC_FORMAT_SUMMARY}`,
        suggestMode: fitsOtherMode ? otherMode : undefined,
      });
      return;
    }

    setDropNotice(null);
    let succeeded = 0;
    const failedNames: string[] = [];

    for (let i = 0; i < validFiles.length; i++) {
      const file = validFiles[i];
      setDropProgress(
        validFiles.length > 1
          ? `正在导入 (${i + 1}/${validFiles.length})：${file.name}`
          : `正在解析并入库：${file.name}`
      );
      try {
        if (mode === "novel") {
          await uploadBook(file);
        } else {
          await uploadDoc(file);
        }
        succeeded += 1;
      } catch {
        failedNames.push(file.name);
      }
    }

    setDropProgress(null);

    if (succeeded > 0 && failedNames.length === 0 && invalidFiles.length === 0) {
      setDropNotice({
        kind: "success",
        text:
          succeeded === 1
            ? `已成功导入「${validFiles[0].name}」`
            : `已成功导入 ${succeeded} 个${mode === "novel" ? "小说" : "文档"}文件`,
      });
    } else if (succeeded > 0) {
      const skipped = [...invalidFiles.map((f) => f.name), ...failedNames].join("、");
      setDropNotice({
        kind: "error",
        text: `已导入 ${succeeded} 个文件，以下文件未导入：${skipped}`,
      });
    }
  }

  const formatBadges = mode === "novel" ? NOVEL_FORMAT_BADGES : DOC_FORMAT_BADGES;

  return (
    <div
      className="relative flex flex-1 min-h-0 overflow-hidden"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={(e) => void handleWorkspaceDrop(e)}
    >
      {/* Desktop Left Sidebar */}
      <div className="hidden md:flex shrink-0">
        <LeftSidebar
          onDragCleanup={resetDragState}
          onAppendDropNotice={(notice) => setDropNotice(notice)}
        />
      </div>

      {/* Mobile Left Drawer */}
      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-40 flex md:hidden">
          <div
            className="sl-animate-fade fixed inset-0 bg-black/45"
            onClick={() => setMobileSidebarOpen(false)}
          />
          <div className="sl-animate-drawer-left relative z-50 h-full">
            <LeftSidebar
              onDragCleanup={resetDragState}
              onAppendDropNotice={(notice) => setDropNotice(notice)}
            />
          </div>
        </div>
      )}

      {/* Mobile Bookshelf Landing View (< md when mobileView === "shelf") */}
      {mobileView === "shelf" && <MobileBookshelf />}

      {/* Center Chat Stage (always visible on Desktop >= md; visible on Mobile when mobileView === "workspace") */}
      <main
        className={`${
          mobileView === "shelf" ? "hidden md:flex" : "flex"
        } flex-1 flex-col min-w-0 min-h-0`}
      >
        {dropProgress && (
          <div className="flex items-center gap-2 border-b border-accent/30 bg-accent-soft/70 px-4 py-1.5 text-xs text-ink shrink-0">
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" />
            <span className="truncate font-medium">{dropProgress}</span>
          </div>
        )}
        {dropNotice && (
          <div
            className={`flex items-center justify-between gap-2 border-b px-4 py-1.5 text-xs shrink-0 ${
              dropNotice.kind === "success"
                ? "border-success/30 bg-success/10 text-success"
                : "border-danger/30 bg-danger/10 text-danger"
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              {dropNotice.kind === "success" && (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              )}
              <span className="truncate">{dropNotice.text}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {dropNotice.suggestMode && (
                <button
                  type="button"
                  onClick={() => {
                    setMode(dropNotice.suggestMode!);
                    setDropNotice(null);
                  }}
                  className="rounded-md border border-current px-2 py-0.5 text-[11px] font-medium hover:opacity-80"
                >
                  切换到{dropNotice.suggestMode === "novel" ? "网文模式" : "文档模式"}
                </button>
              )}
              <button
                type="button"
                onClick={() => setDropNotice(null)}
                className="underline"
              >
                关闭
              </button>
            </div>
          </div>
        )}
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

      {/* PC Drag-and-Drop Overlay (pointer-events-none so left bookshelf cards can still receive append drops) */}
      {draggingFiles && (
        <div className="sl-animate-fade pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-canvas/75 p-4 backdrop-blur-[2px]">
          <div className="sl-animate-pop flex w-full max-w-md flex-col items-center rounded-2xl border-2 border-dashed border-accent bg-surface/95 px-6 py-7 text-center shadow-lg">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
              {mode === "novel" ? (
                <BookOpen className="h-6 w-6" />
              ) : (
                <FileText className="h-6 w-6" />
              )}
            </div>
            <h2 className="mt-3.5 flex items-center gap-1.5 text-sm font-semibold text-ink">
              <Upload className="h-4 w-4 text-accent" />
              <span>{mode === "novel" ? "松开鼠标导入小说" : "松开鼠标上传文档"}</span>
            </h2>
            <p className="mt-1 text-xs text-ink-secondary">
              支持单文件或多文件批量拖拽入库
            </p>
            <div className="mt-3.5 flex flex-wrap justify-center gap-1.5">
              {formatBadges.map((fmt) => (
                <span
                  key={fmt}
                  className="rounded-md border border-line bg-elevated px-2 py-0.5 font-mono text-[10px] font-medium text-ink-secondary"
                >
                  {fmt}
                </span>
              ))}
            </div>
            {mode === "novel" && books.length > 0 && (
              <p className="mt-3 text-[11px] text-ink-muted">
                提示：直接拖到左侧书架的指定书籍卡片上，可执行连载追更追加
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
