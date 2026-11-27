import { useRef, useState } from "react";
import {
  FilePlus2,
  FileText,
  LogOut,
  MoreVertical,
  Plus,
  Smartphone,
  Trash2,
  Upload,
} from "lucide-react";
import { useAppStore } from "../../stores/appStore";
import { useAuthStore } from "../../stores/authStore";
import { useChatStore } from "../../stores/chatStore";
import { BookCover } from "../common/BookCover";
import {
  DOC_ACCEPT,
  DOC_FORMAT_BADGES,
  NOVEL_ACCEPT,
  NOVEL_FORMAT_BADGES,
} from "../common/fileFormats";

export function MobileBookshelf() {
  const {
    mode,
    books,
    docs,
    loadingBooks,
    loadingDocs,
    uploading,
    actionError,
    clearActionError,
    selectBook,
    selectDoc,
    uploadBook,
    appendBook,
    deleteBook,
    uploadDoc,
    deleteDoc,
    setMobileView,
    setNovelTab,
  } = useAppStore();
  const { user, logout } = useAuthStore();
  const { newSession } = useChatStore();

  const bookInputRef = useRef<HTMLInputElement>(null);
  const appendInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);

  const [appendTargetId, setAppendTargetId] = useState<number | null>(null);
  const [menuItemId, setMenuItemId] = useState<number | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const hasAndroidBridge = Boolean(window.ScrollLensApp?.openServerConfig);

  async function handleBookFilesUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setNotice(null);
    for (const file of Array.from(files)) {
      try {
        const created = await uploadBook(file);
        setNotice(`已导入《${created.title}》`);
      } catch {
        // actionError in store handles error display
      }
    }
  }

  async function handleAppendUpload(file: File | undefined) {
    if (!file || !appendTargetId) return;
    const target = books.find((b) => b.id === appendTargetId);
    try {
      const res = await appendBook(appendTargetId, file);
      setNotice(
        res.appended_chapters > 0
          ? `已为《${target?.title ?? "书籍"}》追更 ${res.appended_chapters} 章`
          : `《${target?.title ?? "书籍"}》已是最新，无新增章节`
      );
    } catch {
      // handled by store
    } finally {
      setAppendTargetId(null);
    }
  }

  async function handleDocFilesUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setNotice(null);
    for (const file of Array.from(files)) {
      try {
        const created = await uploadDoc(file);
        setNotice(`已上传「${created.filename}」`);
      } catch {
        // handled by store
      }
    }
  }

  function openBookWorkspace(bookId: number) {
    setMenuItemId(null);
    setConfirmDeleteId(null);
    selectBook(bookId);
    setNovelTab("chat");
    newSession();
    setMobileView("workspace");
  }

  function openDocWorkspace(docId: number) {
    setMenuItemId(null);
    setConfirmDeleteId(null);
    selectDoc(docId);
    newSession();
    setMobileView("workspace");
  }

  return (
    <div
      className="flex flex-1 flex-col min-h-0 bg-canvas md:hidden"
      onClick={() => {
        if (menuItemId !== null) {
          setMenuItemId(null);
          setConfirmDeleteId(null);
        }
      }}
    >
      {/* Hidden file inputs */}
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

      {/* Shelf Action Header */}
      <div className="flex items-center justify-between gap-2 border-b border-line bg-surface/80 px-3.5 py-2.5 shrink-0">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-ink">
            {mode === "novel" ? "我的书架" : "我的文档"}
          </div>
          <div className="sl-num text-[11px] text-ink-muted">
            {mode === "novel"
              ? `共 ${books.length} 本小说 · 点击封面开始问答与精读`
              : `共 ${docs.length} 份文档 · 点击文档开始提问溯源`}
          </div>
        </div>

        <button
          type="button"
          disabled={uploading}
          onClick={() =>
            mode === "novel"
              ? bookInputRef.current?.click()
              : docInputRef.current?.click()
          }
          className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl bg-accent px-3.5 text-xs font-medium text-accent-fg disabled:opacity-50"
        >
          <Plus className="h-4 w-4 shrink-0" />
          <span>
            {uploading
              ? "解析中..."
              : mode === "novel"
                ? "导入小说"
                : "上传文档"}
          </span>
        </button>
      </div>

      {/* Status / Error banners */}
      {actionError && (
        <div className="flex items-center justify-between border-b border-danger/30 bg-danger/10 px-3.5 py-2 text-xs text-danger shrink-0">
          <span className="truncate">{actionError}</span>
          <button
            type="button"
            onClick={clearActionError}
            className="ml-2 shrink-0 underline"
          >
            关闭
          </button>
        </div>
      )}
      {notice && (
        <div className="flex items-center justify-between border-b border-accent/30 bg-accent-soft/70 px-3.5 py-2 text-xs text-ink shrink-0">
          <span className="truncate">{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="ml-2 shrink-0 underline"
          >
            关闭
          </button>
        </div>
      )}

      {/* Main Scrollable Grid */}
      <div className="flex-1 overflow-y-auto px-3.5 pt-3.5 pb-[max(2rem,calc(1.25rem+env(safe-area-inset-bottom)))]">
        {mode === "novel" ? (
          loadingBooks && books.length === 0 ? (
            <div className="py-16 text-center text-xs text-ink-muted">
              正在加载书架...
            </div>
          ) : books.length === 0 ? (
            <div className="mt-6 flex flex-col items-center rounded-2xl border border-dashed border-line-strong bg-surface px-5 py-8 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                <Upload className="h-6 w-6" />
              </div>
              <h2 className="mt-3.5 text-sm font-semibold text-ink">
                书架空空如也
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-ink-secondary">
                导入本地小说即可自动还原分卷、提取原封面并建立防剧透全文索引。
              </p>
              <div className="mt-3.5 flex flex-wrap justify-center gap-1.5">
                {NOVEL_FORMAT_BADGES.map((fmt) => (
                  <span
                    key={fmt}
                    className="rounded-md border border-line bg-elevated px-2 py-0.5 font-mono text-[10px] text-ink-secondary"
                  >
                    {fmt}
                  </span>
                ))}
              </div>
              <button
                type="button"
                disabled={uploading}
                onClick={() => bookInputRef.current?.click()}
                className="mt-5 inline-flex h-10 items-center gap-1.5 rounded-xl bg-accent px-5 text-xs font-medium text-accent-fg disabled:opacity-50"
              >
                <Upload className="h-4 w-4" />
                <span>{uploading ? "解析入库中..." : "选择小说文件导入"}</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-x-3 gap-y-4">
              {books.map((book) => {
                const isMenuOpen = menuItemId === book.id;
                const isConfirmDel = confirmDeleteId === book.id;
                return (
                  <div key={book.id} className="relative flex flex-col">
                    <button
                      type="button"
                      onClick={() => openBookWorkspace(book.id)}
                      className="text-left focus:outline-none"
                    >
                      <BookCover book={book} />
                      <div className="mt-1.5 line-clamp-2 text-[12.5px] font-medium leading-snug text-ink">
                        {book.title}
                      </div>
                    </button>

                    <div className="mt-0.5 flex items-center justify-between gap-1">
                      <span className="sl-num truncate text-[10.5px] text-ink-muted">
                        {book.read_progress_ch}/{book.total_chapters}章
                      </span>
                      <button
                        type="button"
                        aria-label={`更多操作 ${book.title}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setConfirmDeleteId(null);
                          setMenuItemId(isMenuOpen ? null : book.id);
                        }}
                        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink-muted hover:bg-hover hover:text-ink"
                      >
                        <MoreVertical className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {isMenuOpen && (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="absolute right-0 bottom-8 z-30 w-36 rounded-xl border border-line-strong bg-surface p-1 shadow-lg"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setMenuItemId(null);
                            setAppendTargetId(book.id);
                            appendInputRef.current?.click();
                          }}
                          className="flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-xs text-ink hover:bg-hover"
                        >
                          <FilePlus2 className="h-3.5 w-3.5 text-accent" />
                          <span>连载追更</span>
                        </button>
                        {isConfirmDel ? (
                          <button
                            type="button"
                            onClick={() => {
                              setMenuItemId(null);
                              setConfirmDeleteId(null);
                              void deleteBook(book.id);
                            }}
                            className="flex h-9 w-full items-center gap-2 rounded-lg bg-danger px-2.5 text-left text-xs font-medium text-white"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span>确认删除？</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(book.id)}
                            className="flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-xs text-danger hover:bg-danger/10"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span>删除书籍</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )
        ) : loadingDocs && docs.length === 0 ? (
          <div className="py-16 text-center text-xs text-ink-muted">
            正在加载文档...
          </div>
        ) : docs.length === 0 ? (
          <div className="mt-6 flex flex-col items-center rounded-2xl border border-dashed border-line-strong bg-surface px-5 py-8 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
              <FileText className="h-6 w-6" />
            </div>
            <h2 className="mt-3.5 text-sm font-semibold text-ink">
              暂无日常文档
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-ink-secondary">
              上传 PDF、PPTX、DOCX、Markdown 或 TXT，随时提问并附带页码溯源。
            </p>
            <div className="mt-3.5 flex flex-wrap justify-center gap-1.5">
              {DOC_FORMAT_BADGES.map((fmt) => (
                <span
                  key={fmt}
                  className="rounded-md border border-line bg-elevated px-2 py-0.5 font-mono text-[10px] text-ink-secondary"
                >
                  {fmt}
                </span>
              ))}
            </div>
            <button
              type="button"
              disabled={uploading}
              onClick={() => docInputRef.current?.click()}
              className="mt-5 inline-flex h-10 items-center gap-1.5 rounded-xl bg-accent px-5 text-xs font-medium text-accent-fg disabled:opacity-50"
            >
              <Upload className="h-4 w-4" />
              <span>{uploading ? "解析入库中..." : "选择文档上传"}</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {docs.map((doc) => {
              const isMenuOpen = menuItemId === doc.id;
              const isConfirmDel = confirmDeleteId === doc.id;
              return (
                <div
                  key={doc.id}
                  className="relative flex flex-col rounded-2xl border border-line bg-surface p-3"
                >
                  <button
                    type="button"
                    onClick={() => openDocWorkspace(doc.id)}
                    className="flex flex-1 flex-col text-left focus:outline-none"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="rounded-md bg-accent-soft px-2 py-0.5 font-mono text-[10px] font-semibold uppercase text-accent">
                        {doc.file_type}
                      </span>
                      <span className="sl-num text-[11px] text-ink-muted">
                        {doc.total_pages} 页
                      </span>
                    </div>
                    <div className="mt-2.5 line-clamp-2 text-[13px] font-medium leading-snug text-ink">
                      {doc.filename}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      <span className="rounded bg-elevated px-1.5 py-0.5 text-[10px] text-ink-secondary">
                        {doc.retrieval_mode === "direct" ? "全文直读" : "分页检索"}
                      </span>
                      {doc.has_scanned_pages && (
                        <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[10px] text-warning">
                          含扫描页
                        </span>
                      )}
                    </div>
                  </button>

                  <div className="mt-2 flex items-center justify-end border-t border-line pt-1.5">
                    <button
                      type="button"
                      aria-label={`更多操作 ${doc.filename}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setConfirmDeleteId(null);
                        setMenuItemId(isMenuOpen ? null : doc.id);
                      }}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-ink-muted hover:bg-hover hover:text-ink"
                    >
                      <MoreVertical className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {isMenuOpen && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="absolute right-2 bottom-10 z-30 w-32 rounded-xl border border-line-strong bg-surface p-1 shadow-lg"
                    >
                      {isConfirmDel ? (
                        <button
                          type="button"
                          onClick={() => {
                            setMenuItemId(null);
                            setConfirmDeleteId(null);
                            void deleteDoc(doc.id);
                          }}
                          className="flex h-9 w-full items-center gap-2 rounded-lg bg-danger px-2.5 text-left text-xs font-medium text-white"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          <span>确认删除？</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(doc.id)}
                          className="flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-xs text-danger hover:bg-danger/10"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          <span>删除文档</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Bottom subtle account & server strip */}
        <div className="mt-8 flex items-center justify-between gap-2 border-t border-line pt-4 text-xs text-ink-muted">
          <span className="truncate">当前账号：{user?.username ?? ""}</span>
          <div className="flex shrink-0 items-center gap-2">
            {hasAndroidBridge && (
              <button
                type="button"
                onClick={() => window.ScrollLensApp?.openServerConfig()}
                className="inline-flex h-9 items-center gap-1 rounded-xl border border-line bg-surface px-2.5 text-xs text-ink-secondary"
              >
                <Smartphone className="h-3.5 w-3.5" />
                <span>切换服务器</span>
              </button>
            )}
            <button
              type="button"
              onClick={logout}
              className="inline-flex h-9 items-center gap-1 rounded-xl border border-line bg-surface px-2.5 text-xs text-ink-secondary hover:text-danger"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>退出</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
