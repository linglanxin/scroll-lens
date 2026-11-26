import { useEffect, useRef, useState } from "react";
import {
  FilePlus2,
  Lock,
  MessageSquarePlus,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useAppStore } from "../../stores/appStore";
import { useChatStore } from "../../stores/chatStore";

export function LeftSidebar() {
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
    updateReadProgress,
    uploadDoc,
    deleteDoc,
    uploading,
    setMobileSidebarOpen,
  } = useAppStore();

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
  const [progressInput, setProgressInput] = useState<string>("");

  const activeBook = books.find((b) => b.id === selectedBookId) ?? null;

  useEffect(() => {
    if (activeBook) {
      setProgressInput(String(activeBook.read_progress_ch));
    }
  }, [activeBook?.id, activeBook?.read_progress_ch]);

  async function handleBookUpload(file: File | undefined) {
    if (!file) return;
    await uploadBook(file);
  }

  async function handleAppendUpload(file: File | undefined) {
    if (!file || !appendTargetId) return;
    await appendBook(appendTargetId, file);
    setAppendTargetId(null);
  }

  async function handleDocUpload(file: File | undefined) {
    if (!file) return;
    await uploadDoc(file);
  }

  return (
    <aside className="flex h-full w-72 flex-col border-r border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-3 py-2.5">
        <span className="text-xs font-semibold uppercase tracking-wider text-ink-secondary">
          {mode === "novel" ? "我的书架" : "我的文档"}
        </span>
        <div className="flex items-center gap-1">
          {mode === "novel" ? (
            <>
              <input
                ref={bookInputRef}
                type="file"
                accept=".txt,.epub"
                className="hidden"
                onChange={(e) => {
                  void handleBookUpload(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <input
                ref={appendInputRef}
                type="file"
                accept=".txt,.epub"
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
                className="flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-xs font-medium text-accent-fg hover:opacity-95 disabled:opacity-50"
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
                accept=".pdf,.pptx,.docx,.md,.txt"
                className="hidden"
                onChange={(e) => {
                  void handleDocUpload(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                disabled={uploading}
                onClick={() => docInputRef.current?.click()}
                className="flex items-center gap-1 rounded-md bg-accent px-2 py-1 text-xs font-medium text-accent-fg hover:opacity-95 disabled:opacity-50"
              >
                <Upload className="h-3.5 w-3.5" />
                <span>{uploading ? "解析中..." : "上传文档"}</span>
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => setMobileSidebarOpen(false)}
            className="rounded-md p-1 text-ink-secondary hover:bg-hover md:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Resource List */}
      <div className="max-h-[45%] overflow-y-auto p-2 space-y-1.5 border-b border-line">
        {mode === "novel" ? (
          books.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-ink-muted">
              暂无小说，支持导入 TXT / EPUB
            </p>
          ) : (
            books.map((book) => {
              const selected = book.id === selectedBookId;
              return (
                <div
                  key={book.id}
                  onClick={() => selectBook(book.id)}
                  className={`group cursor-pointer rounded-lg border p-2.5 transition ${
                    selected
                      ? "border-accent bg-accent-soft/50"
                      : "border-transparent hover:border-line hover:bg-elevated"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-ink">
                        {book.title}
                      </div>
                      <div className="mt-0.5 text-[11px] text-ink-secondary">
                        {book.total_volumes} 卷 · {book.total_chapters} 章 ·{" "}
                        {(book.total_chars / 10000).toFixed(1)} 万字
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5 opacity-80 group-hover:opacity-100">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setAppendTargetId(book.id);
                          appendInputRef.current?.click();
                        }}
                        className="rounded p-1 text-ink-secondary hover:bg-hover hover:text-ink"
                        title="连载追更（增量追加）"
                      >
                        <FilePlus2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void deleteBook(book.id);
                        }}
                        className="rounded p-1 text-ink-secondary hover:bg-hover hover:text-danger"
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
          <p className="px-2 py-6 text-center text-xs text-ink-muted">
            暂无文档，支持 PDF / PPTX / DOCX / MD / TXT
          </p>
        ) : (
          docs.map((doc) => {
            const selected = doc.id === selectedDocId;
            return (
              <div
                key={doc.id}
                onClick={() => selectDoc(doc.id)}
                className={`group cursor-pointer rounded-lg border p-2.5 transition ${
                  selected
                    ? "border-accent bg-accent-soft/50"
                    : "border-transparent hover:border-line hover:bg-elevated"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-ink">
                      {doc.filename}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-ink-secondary">
                      <span className="uppercase">{doc.file_type}</span>
                      <span>· {doc.total_pages} 页</span>
                      <span className="rounded bg-elevated px-1 py-0.5 text-[10px]">
                        {doc.retrieval_mode === "direct" ? "全文直读" : "分页检索"}
                      </span>
                      {doc.has_scanned_pages && (
                        <span className="rounded bg-warning/15 px-1 py-0.5 text-[10px] text-warning">
                          含扫描页
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
                    className="rounded p-1 text-ink-secondary hover:bg-hover hover:text-danger"
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

      {/* Anti-Spoiler Progress Lock */}
      {mode === "novel" && activeBook && (
        <div className="border-b border-line bg-elevated/60 px-3 py-2.5">
          <div className="flex items-center justify-between text-xs font-medium text-ink">
            <span className="flex items-center gap-1">
              <Lock className="h-3.5 w-3.5 text-accent" />
              防剧透进度锁
            </span>
            <span className="text-[11px] text-ink-secondary">
              上限 {activeBook.total_chapters} 章
            </span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <input
              type="range"
              min={1}
              max={Math.max(1, activeBook.total_chapters)}
              value={Number(progressInput) || activeBook.read_progress_ch}
              onChange={(e) => setProgressInput(e.target.value)}
              onMouseUp={() =>
                void updateReadProgress(
                  activeBook.id,
                  Math.max(1, Number(progressInput) || 1)
                )
              }
              onTouchEnd={() =>
                void updateReadProgress(
                  activeBook.id,
                  Math.max(1, Number(progressInput) || 1)
                )
              }
              className="flex-1 accent-accent"
            />
            <input
              type="number"
              min={1}
              max={Math.max(1, activeBook.total_chapters)}
              value={progressInput}
              onChange={(e) => setProgressInput(e.target.value)}
              onBlur={() =>
                void updateReadProgress(
                  activeBook.id,
                  Math.max(1, Number(progressInput) || 1)
                )
              }
              className="w-16 rounded border border-line bg-surface px-1.5 py-0.5 text-xs text-ink text-right"
            />
          </div>
        </div>
      )}

      {/* Sessions List */}
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-semibold text-ink-secondary">历史对话</span>
        <button
          type="button"
          onClick={newSession}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-accent hover:bg-accent-soft"
        >
          <MessageSquarePlus className="h-3.5 w-3.5" />
          <span>新对话</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-1">
        {sessions.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-ink-muted">暂无历史会话</p>
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
                className={`group flex cursor-pointer items-center justify-between rounded-lg px-2.5 py-2 text-xs transition ${
                  active
                    ? "bg-elevated font-medium text-ink border border-line"
                    : "text-ink-secondary hover:bg-hover hover:text-ink"
                }`}
              >
                <span className="truncate">{sess.title}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void deleteSession(sess.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 rounded p-0.5 text-ink-muted hover:text-danger"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
