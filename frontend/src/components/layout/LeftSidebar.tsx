import { useRef, useState, type DragEvent } from "react";
import {
  FilePlus2,
  Lock,
  LogOut,
  MessageSquarePlus,
  Moon,
  Smartphone,
  Sun,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useAppStore } from "../../stores/appStore";
import { useAuthStore } from "../../stores/authStore";
import { useChatStore } from "../../stores/chatStore";
import {
  DOC_ACCEPT,
  DOC_FORMAT_SUMMARY,
  NOVEL_ACCEPT,
  NOVEL_FORMAT_SUMMARY,
  hasDraggedFiles,
  isSupportedNovelFile,
} from "../common/fileFormats";

export interface DropNotice {
  kind: "success" | "error";
  text: string;
}

interface LeftSidebarProps {
  onDragCleanup?: () => void;
  onAppendDropNotice?: (notice: DropNotice) => void;
}

export function LeftSidebar({ onDragCleanup, onAppendDropNotice }: LeftSidebarProps = {}) {
  const {
    mode,
    books,
    docs,
    selectedBookId,
    selectedDocId,
    selectBook,
    selectDoc,
    uploadBook,
    appendBook,
    deleteBook,
    uploadDoc,
    deleteDoc,
    uploading,
    setMobileSidebarOpen,
    theme,
    toggleTheme,
  } = useAppStore();
  const { user, logout } = useAuthStore();
  const hasAndroidBridge = Boolean(window.ScrollLensApp?.openServerConfig);

  const {
    sessions,
    activeSessionId,
    selectSession,
    newSession,
    deleteSession,
  } = useChatStore();

  const bookInputRef = useRef<HTMLInputElement>(null);
  const appendInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const [appendTargetId, setAppendTargetId] = useState<number | null>(null);
  const [dragAppendBookId, setDragAppendBookId] = useState<number | null>(null);

  const activeBook = books.find((b) => b.id === selectedBookId) ?? null;

  async function handleBookFilesUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      try {
        await uploadBook(file);
      } catch {
        // actionError in store displays the failure detail
      }
    }
  }

  async function handleAppendUpload(file: File | undefined) {
    if (!file || !appendTargetId) return;
    const targetBook = books.find((b) => b.id === appendTargetId);
    try {
      const res = await appendBook(appendTargetId, file);
      onAppendDropNotice?.({
        kind: "success",
        text:
          res.appended_chapters > 0
            ? `已为《${targetBook?.title ?? "书籍"}》追更追加 ${res.appended_chapters} 章`
            : `《${targetBook?.title ?? "书籍"}》已是最新，未检测到新增章节`,
      });
    } catch {
      // handled by store actionError
    } finally {
      setAppendTargetId(null);
    }
  }

  async function handleDocFilesUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      try {
        await uploadDoc(file);
      } catch {
        // handled by store actionError
      }
    }
  }

  function handleBookCardDragOver(e: DragEvent<HTMLDivElement>, bookId: number) {
    if (mode !== "novel" || !hasDraggedFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    if (dragAppendBookId !== bookId) {
      setDragAppendBookId(bookId);
    }
  }

  function handleBookCardDragLeave(e: DragEvent<HTMLDivElement>, bookId: number) {
    if (dragAppendBookId !== bookId) return;
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setDragAppendBookId(null);
    }
  }

  async function handleBookCardDrop(
    e: DragEvent<HTMLDivElement>,
    bookId: number,
    bookTitle: string
  ) {
    if (mode !== "novel" || !hasDraggedFiles(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    setDragAppendBookId(null);
    onDragCleanup?.();

    if (uploading) return;
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (!isSupportedNovelFile(file.name)) {
      onAppendDropNotice?.({
        kind: "error",
        text: `追更失败：不支持的格式「${file.name}」。支持：${NOVEL_FORMAT_SUMMARY}`,
      });
      return;
    }
    try {
      const res = await appendBook(bookId, file);
      onAppendDropNotice?.({
        kind: "success",
        text:
          res.appended_chapters > 0
            ? `已为《${bookTitle}》追更追加 ${res.appended_chapters} 章`
            : `《${bookTitle}》已是最新，未检测到新增章节`,
      });
    } catch {
      // handled by store actionError
    }
  }

  return (
    <aside className="flex h-full w-[84vw] max-w-[300px] md:w-[268px] flex-col border-r border-line bg-surface">
      {/* Header + Upload action */}
      <div className="flex items-center justify-between border-b border-line px-3 py-2.5">
        <span className="text-xs font-semibold text-ink-secondary">
          {mode === "novel" ? "我的书架" : "我的文档"}
        </span>

        <div className="flex items-center gap-1">
          {mode === "novel" ? (
            <>
              <input
                ref={bookInputRef}
                type="file"
                multiple
                accept={NOVEL_ACCEPT}
                className="hidden"
                onChange={(e) => {
                  void handleBookFilesUpload(e.target.files);
                  e.target.value = "";
                }}
              />
              <input
                ref={appendInputRef}
                type="file"
                accept={NOVEL_ACCEPT}
                className="hidden"
                onChange={(e) => {
                  void handleAppendUpload(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                disabled={uploading}
                onClick={() => bookInputRef.current?.click()}
                className="sl-btn flex h-8 items-center gap-1.5 rounded-lg bg-accent px-2.5 text-xs font-medium text-accent-fg disabled:opacity-50"
                title={`支持 ${NOVEL_FORMAT_SUMMARY}（支持直接拖拽文件到窗口）`}
              >
                <Upload className="h-3.5 w-3.5" />
                <span>{uploading ? "解析中..." : "导入小说"}</span>
              </button>
            </>
          ) : (
            <>
              <input
                ref={docInputRef}
                type="file"
                multiple
                accept={DOC_ACCEPT}
                className="hidden"
                onChange={(e) => {
                  void handleDocFilesUpload(e.target.files);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                disabled={uploading}
                onClick={() => docInputRef.current?.click()}
                className="sl-btn flex h-8 items-center gap-1.5 rounded-lg bg-accent px-2.5 text-xs font-medium text-accent-fg disabled:opacity-50"
                title={`支持 ${DOC_FORMAT_SUMMARY}（支持直接拖拽文件到窗口）`}
              >
                <Upload className="h-3.5 w-3.5" />
                <span>{uploading ? "解析中..." : "上传文档"}</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => setMobileSidebarOpen(false)}
            className="sl-btn inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-secondary hover:bg-hover md:hidden"
            aria-label="关闭侧边栏"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Resource List */}
      <div className="max-h-[46%] overflow-y-auto p-2 space-y-1 border-b border-line">
        {mode === "novel" ? (
          books.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line px-3 py-5 text-center text-xs text-ink-muted space-y-1">
              <p className="font-medium text-ink-secondary">暂无小说，可直接拖拽文件到此</p>
              <p className="text-[11px] leading-relaxed">
                支持 TXT / EPUB / MOBI / AZW3 / FB2 / PDF / DOCX / MD / HTML / ZIP
              </p>
            </div>
          ) : (
            books.map((book) => {
              const selected = book.id === selectedBookId;
              const isDropTarget = dragAppendBookId === book.id;
              return (
                <div
                  key={book.id}
                  onClick={() => selectBook(book.id)}
                  onDragOver={(e) => handleBookCardDragOver(e, book.id)}
                  onDragLeave={(e) => handleBookCardDragLeave(e, book.id)}
                  onDrop={(e) => void handleBookCardDrop(e, book.id, book.title)}
                  className={`group relative cursor-pointer rounded-xl px-2.5 py-2 transition ${
                    isDropTarget
                      ? "bg-accent-soft ring-1 ring-accent text-ink"
                      : selected
                      ? "bg-hover text-ink"
                      : "text-ink-secondary hover:bg-elevated hover:text-ink"
                  }`}
                >
                  {selected && !isDropTarget && (
                    <span className="absolute left-1 top-2.5 bottom-2.5 w-0.5 rounded-full bg-accent" />
                  )}
                  <div className="flex items-start justify-between gap-2 pl-1.5">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-medium text-ink">
                        {book.title}
                      </div>
                      {isDropTarget ? (
                        <div className="mt-0.5 text-[11px] font-medium text-accent">
                          松开即可增量追更此书
                        </div>
                      ) : (
                        <div className="sl-num mt-0.5 text-[11px] text-ink-muted">
                          {book.total_volumes} 卷 · {book.total_chapters} 章 ·{" "}
                          {(book.total_chars / 10000).toFixed(1)} 万字
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0 opacity-90 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setAppendTargetId(book.id);
                          appendInputRef.current?.click();
                        }}
                        className="rounded-md p-1.5 text-ink-secondary hover:bg-surface hover:text-ink"
                        title="连载追更（增量追加，也可直接拖文件到本书卡片）"
                      >
                        <FilePlus2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void deleteBook(book.id);
                        }}
                        className="rounded-md p-1.5 text-ink-secondary hover:bg-surface hover:text-danger"
                        title="删除书籍"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )
        ) : docs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line px-3 py-5 text-center text-xs text-ink-muted space-y-1">
            <p className="font-medium text-ink-secondary">暂无文档，可直接拖拽文件到此</p>
            <p className="text-[11px] leading-relaxed">
              支持 PDF / PPTX / DOCX / MD / TXT
            </p>
          </div>
        ) : (
          docs.map((doc) => {
            const selected = doc.id === selectedDocId;
            return (
              <div
                key={doc.id}
                onClick={() => selectDoc(doc.id)}
                className={`group relative cursor-pointer rounded-xl px-2.5 py-2 transition ${
                  selected
                    ? "bg-hover text-ink"
                    : "text-ink-secondary hover:bg-elevated hover:text-ink"
                }`}
              >
                {selected && (
                  <span className="absolute left-1 top-2.5 bottom-2.5 w-0.5 rounded-full bg-accent" />
                )}
                <div className="flex items-start justify-between gap-2 pl-1.5">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium text-ink">
                      {doc.filename}
                    </div>
                    <div className="sl-num mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-muted">
                      <span className="uppercase">{doc.file_type}</span>
                      <span>· {doc.total_pages} 页</span>
                      <span className="rounded bg-surface px-1 py-0.5 text-[10px] border border-line">
                        {doc.retrieval_mode === "direct" ? "直读" : "分页"}
                      </span>
                      {doc.has_scanned_pages && (
                        <span className="rounded bg-warning/15 px-1 py-0.5 text-[10px] text-warning">
                          扫描页
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void deleteDoc(doc.id);
                    }}
                    className="shrink-0 opacity-90 sm:opacity-0 sm:group-hover:opacity-100 rounded-md p-1.5 text-ink-secondary hover:bg-surface hover:text-danger transition-opacity"
                    title="删除文档"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Compact Anti-Spoiler Status Readout */}
      {mode === "novel" && activeBook && (
        <div className="flex items-center justify-between border-b border-line bg-elevated/50 px-3 py-2 text-[11px]">
          <span className="flex items-center gap-1.5 text-ink-secondary">
            <Lock className="h-3 w-3 text-accent" />
            <span>阅读进度锁</span>
          </span>
          <span className="sl-num font-medium text-ink">
            {activeBook.read_progress_ch} / {activeBook.total_chapters} 章
          </span>
        </div>
      )}

      {/* Sessions Header */}
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-semibold text-ink-secondary">历史对话</span>
        <button
          type="button"
          onClick={newSession}
          className="sl-btn flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-accent hover:bg-accent-soft"
        >
          <MessageSquarePlus className="h-3.5 w-3.5" />
          <span>新对话</span>
        </button>
      </div>

      {/* Sessions List */}
      <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
        {sessions.length === 0 ? (
          <p className="px-2 py-5 text-center text-xs text-ink-muted">暂无历史会话</p>
        ) : (
          sessions.map((sess) => {
            const active = sess.id === activeSessionId;
            return (
              <div
                key={sess.id}
                onClick={() => {
                  void selectSession(sess.id);
                  setMobileSidebarOpen(false);
                }}
                className={`group flex cursor-pointer items-center justify-between rounded-xl px-2.5 py-2 text-xs transition ${
                  active
                    ? "bg-hover font-medium text-ink"
                    : "text-ink-secondary hover:bg-elevated hover:text-ink"
                }`}
              >
                <span className="truncate">{sess.title}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void deleteSession(sess.id);
                  }}
                  className="shrink-0 opacity-80 sm:opacity-0 sm:group-hover:opacity-100 rounded p-1 text-ink-muted hover:text-danger transition-opacity"
                  aria-label="删除会话"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Mobile Drawer Footer Utilities (Theme / Server / Logout) */}
      <div className="flex items-center justify-between gap-1.5 border-t border-line bg-elevated/50 px-2.5 pt-2 sl-pb-safe md:hidden">
        <button
          type="button"
          onClick={toggleTheme}
          className="sl-btn flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-line bg-surface px-2 text-xs font-medium text-ink-secondary hover:text-ink"
          aria-label="切换主题"
        >
          {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
          <span>{theme === "light" ? "夜读" : "浅色"}</span>
        </button>

        {hasAndroidBridge && (
          <button
            type="button"
            onClick={() => {
              setMobileSidebarOpen(false);
              window.ScrollLensApp?.openServerConfig();
            }}
            className="sl-btn flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-line bg-surface px-2 text-xs font-medium text-ink-secondary hover:text-ink"
            aria-label="切换服务器"
          >
            <Smartphone className="h-4 w-4" />
            <span>服务器</span>
          </button>
        )}

        <button
          type="button"
          onClick={logout}
          className="sl-btn flex h-10 items-center justify-center gap-1 rounded-xl border border-line bg-surface px-3 text-xs font-medium text-ink-secondary hover:text-danger"
          title={`退出登录 (${user?.username ?? ""})`}
          aria-label="退出登录"
        >
          <LogOut className="h-4 w-4" />
          <span>退出</span>
        </button>
      </div>
    </aside>
  );
}
