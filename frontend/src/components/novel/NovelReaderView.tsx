import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  List,
  Lock,
  MessageSquare,
  SlidersHorizontal,
  Sparkles,
  UserCheck,
  X,
} from "lucide-react";
import { booksApi } from "../../api/books";
import { useAppStore } from "../../stores/appStore";
import { useReaderStore } from "../../stores/readerStore";
import type { ChapterListItem, Volume } from "../../types/api";

interface ReaderPrefs {
  fontSize: number;
  lineHeight: number;
  width: "narrow" | "medium" | "wide";
  font: "serif" | "sans";
  indent: boolean;
  paper: "default" | "ivory" | "sage" | "warm";
}

const PREFS_KEY = "scroll_lens_reader_prefs";

const DEFAULT_PREFS: ReaderPrefs = {
  fontSize: 17,
  lineHeight: 1.9,
  width: "medium",
  font: "serif",
  indent: true,
  paper: "default",
};

function loadPrefs(): ReaderPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<ReaderPrefs>) };
  } catch {
    return DEFAULT_PREFS;
  }
}

const PAPER_CLASSES: Record<ReaderPrefs["paper"], string> = {
  default: "bg-surface text-ink",
  ivory: "bg-[#FAF6EC] text-[#2A2621]",
  sage: "bg-[#EDF4ED] text-[#1F2C22]",
  warm: "bg-[#F4ECD8] text-[#35291E]",
};

const WIDTH_CLASSES: Record<ReaderPrefs["width"], string> = {
  narrow: "max-w-[640px]",
  medium: "max-w-[760px]",
  wide: "max-w-[920px]",
};

export function NovelReaderView() {
  const {
    books,
    selectedBookId,
    theme,
    updateReadProgress,
    openCardGeneratorWithQuery,
    requestNovelQuestion,
  } = useAppStore();
  const { chapterData, highlightKeyword, loading, openChapter } = useReaderStore();

  const activeBook = books.find((b) => b.id === selectedBookId) ?? null;

  const [prefs, setPrefs] = useState<ReaderPrefs>(loadPrefs);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [tocOpen, setTocOpen] = useState(false);

  const [volumes, setVolumes] = useState<Volume[]>([]);
  const [selectedVolId, setSelectedVolId] = useState<number | null>(null);
  const [chapters, setChapters] = useState<ChapterListItem[]>([]);
  const [tocPage, setTocPage] = useState(1);
  const [tocTotal, setTocTotal] = useState(0);
  const [tocFilter, setTocFilter] = useState("");
  const [jumpInput, setJumpInput] = useState("");
  const [selectedText, setSelectedText] = useState("");

  const contentScrollRef = useRef<HTMLDivElement>(null);
  const articleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // ignore storage quota errors
    }
  }, [prefs]);

  // Open initial or remembered chapter when entering reader for a book
  useEffect(() => {
    if (!activeBook) return;
    if (chapterData && chapterData.book_id === activeBook.id) return;

    let targetCh = Math.max(1, activeBook.read_progress_ch || 1);
    try {
      const saved = Number(localStorage.getItem(`sl_reader_ch_${activeBook.id}`));
      if (saved >= 1 && saved <= activeBook.total_chapters) {
        targetCh = saved;
      }
    } catch {
      // ignore
    }
    void openChapter(activeBook.id, targetCh);
  }, [activeBook, chapterData, openChapter]);

  // Persist last read chapter in reader & scroll to top (or first highlight)
  useEffect(() => {
    if (!chapterData) return;
    try {
      localStorage.setItem(
        `sl_reader_ch_${chapterData.book_id}`,
        String(chapterData.chapter_num)
      );
    } catch {
      // ignore
    }
    setSelectedText("");
    const container = contentScrollRef.current;
    if (!container) return;
    window.requestAnimationFrame(() => {
      const firstMark = articleRef.current?.querySelector("mark");
      if (firstMark) {
        firstMark.scrollIntoView({ behavior: "smooth", block: "center" });
      } else {
        container.scrollTop = 0;
      }
    });
  }, [chapterData?.book_id, chapterData?.chapter_num, highlightKeyword]);

  const loadToc = useCallback(
    async (bookId: number, page = 1, volumeId?: number | null) => {
      try {
        const res = await booksApi.listChapters(
          bookId,
          page,
          100,
          volumeId ?? undefined
        );
        setChapters(res.items);
        setTocTotal(res.total);
        setTocPage(res.page);
      } catch {
        // ignore
      }
    },
    []
  );

  useEffect(() => {
    if (!activeBook || !tocOpen) return;
    void booksApi
      .listVolumes(activeBook.id)
      .then((vols) => setVolumes(vols))
      .catch(() => {});
    void loadToc(activeBook.id, tocPage, selectedVolId);
  }, [activeBook, tocOpen, tocPage, selectedVolId, loadToc]);

  // Keyboard navigation Left/Right
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (!activeBook || !chapterData) return;
      if (e.key === "ArrowLeft" && chapterData.chapter_num > 1) {
        void openChapter(activeBook.id, chapterData.chapter_num - 1);
      } else if (
        e.key === "ArrowRight" &&
        chapterData.chapter_num < activeBook.total_chapters
      ) {
        void openChapter(activeBook.id, chapterData.chapter_num + 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeBook, chapterData, openChapter]);

  function captureSelection() {
    const sel = window.getSelection()?.toString().trim() ?? "";
    if (sel.length >= 2 && sel.length <= 120) {
      setSelectedText(sel);
    } else if (!sel) {
      setSelectedText("");
    }
  }

  const filteredTocChapters = useMemo(() => {
    const q = tocFilter.trim().toLowerCase();
    if (!q) return chapters;
    return chapters.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        String(c.chapter_num).includes(q)
    );
  }, [chapters, tocFilter]);

  if (!activeBook) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-xs text-ink-muted">
        请先选择一部小说开始沉浸阅读。
      </div>
    );
  }

  function renderHighlightedParagraph(text: string, kw: string) {
    if (!kw.trim()) return text;
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(${escaped})`, "gi");
    const parts = text.split(regex);
    return parts.map((part, idx) =>
      regex.test(part) ? (
        <mark key={idx} className="rounded bg-warning/35 px-0.5 text-current">
          {part}
        </mark>
      ) : (
        <span key={idx}>{part}</span>
      )
    );
  }

  const paragraphs = (chapterData?.content ?? "")
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const paperStyle =
    theme === "dark" && prefs.paper !== "default"
      ? PAPER_CLASSES.default
      : PAPER_CLASSES[prefs.paper];

  const isAheadOfProgress =
    chapterData && chapterData.chapter_num > activeBook.read_progress_ch;

  return (
    <section className="relative flex flex-1 flex-col min-w-0 min-h-0 bg-canvas">
      {/* Reader Top Control Bar */}
      <div className="flex h-11 shrink-0 items-center justify-between gap-2 border-b border-line bg-surface/95 px-3 sm:px-5">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={() => setTocOpen(!tocOpen)}
            className={`sl-btn inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium ${
              tocOpen
                ? "border-accent bg-accent-soft text-accent"
                : "border-line bg-elevated text-ink-secondary hover:text-ink"
            }`}
          >
            <List className="h-3.5 w-3.5" />
            <span>目录</span>
          </button>

          {chapterData && (
            <div className="min-w-0 truncate text-xs text-ink-secondary">
              <span className="hidden sm:inline text-ink-muted">
                {chapterData.volume_title} ·{" "}
              </span>
              <span className="font-medium text-ink">{chapterData.title}</span>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {isAheadOfProgress && chapterData && (
            <button
              type="button"
              onClick={() =>
                void updateReadProgress(activeBook.id, chapterData.chapter_num)
              }
              className="sl-btn inline-flex h-8 items-center gap-1 rounded-lg border border-accent/40 bg-accent-soft/70 px-2.5 text-[11px] font-medium text-accent"
              title="将防剧透进度锁推进到当前阅读章节"
            >
              <Lock className="h-3 w-3" />
              <span className="hidden sm:inline">同步进度至此章</span>
              <span className="sm:hidden">同步进度</span>
            </button>
          )}

          {chapterData && (
            <div className="hidden md:flex items-center gap-1 text-xs">
              <input
                type="number"
                min={1}
                max={activeBook.total_chapters}
                value={jumpInput}
                onChange={(e) => setJumpInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && jumpInput.trim()) {
                    const n = Math.max(
                      1,
                      Math.min(activeBook.total_chapters, Number(jumpInput))
                    );
                    setJumpInput("");
                    void openChapter(activeBook.id, n);
                  }
                }}
                placeholder={`${chapterData.chapter_num}/${activeBook.total_chapters}`}
                className="sl-num h-8 w-24 rounded-lg border border-line bg-elevated px-2 text-center text-[11px] text-ink outline-none focus:border-accent"
                title="输入章号按 Enter 跳转"
              />
            </div>
          )}

          <div className="relative">
            <button
              type="button"
              onClick={() => setPrefsOpen(!prefsOpen)}
              className={`sl-btn inline-flex h-8 items-center gap-1 rounded-lg border px-2.5 text-xs ${
                prefsOpen
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-line bg-elevated text-ink-secondary hover:text-ink"
              }`}
              title="排版与纸张设置"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">排版</span>
            </button>

            {prefsOpen && (
              <div className="sl-animate-pop absolute right-0 top-full z-30 mt-2 w-72 rounded-2xl border border-line-strong bg-surface p-4 shadow-lg space-y-3 text-xs">
                <div className="flex items-center justify-between font-semibold text-ink">
                  <span>阅读排版设置</span>
                  <button
                    type="button"
                    onClick={() => setPrefsOpen(false)}
                    className="text-ink-muted hover:text-ink"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-ink-secondary">字号</span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        setPrefs((p) => ({
                          ...p,
                          fontSize: Math.max(14, p.fontSize - 1),
                        }))
                      }
                      className="h-7 w-7 rounded-lg border border-line bg-elevated font-medium"
                    >
                      A-
                    </button>
                    <span className="sl-num w-8 text-center">{prefs.fontSize}</span>
                    <button
                      type="button"
                      onClick={() =>
                        setPrefs((p) => ({
                          ...p,
                          fontSize: Math.min(24, p.fontSize + 1),
                        }))
                      }
                      className="h-7 w-7 rounded-lg border border-line bg-elevated font-medium"
                    >
                      A+
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-ink-secondary">字体</span>
                  <div className="flex gap-1">
                    {(
                      [
                        ["serif", "宋体衬线"],
                        ["sans", "无衬线"],
                      ] as const
                    ).map(([k, lbl]) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setPrefs((p) => ({ ...p, font: k }))}
                        className={`rounded-lg border px-2.5 py-1 ${
                          prefs.font === k
                            ? "border-accent bg-accent-soft text-accent"
                            : "border-line bg-elevated text-ink-secondary"
                        }`}
                      >
                        {lbl}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-ink-secondary">版心宽度</span>
                  <div className="flex gap-1">
                    {(
                      [
                        ["narrow", "窄"],
                        ["medium", "适中"],
                        ["wide", "宽"],
                      ] as const
                    ).map(([k, lbl]) => (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setPrefs((p) => ({ ...p, width: k }))}
                        className={`rounded-lg border px-2 py-1 ${
                          prefs.width === k
                            ? "border-accent bg-accent-soft text-accent"
                            : "border-line bg-elevated text-ink-secondary"
                        }`}
                      >
                        {lbl}
                      </button>
                    ))}
                  </div>
                </div>

                {theme === "light" && (
                  <div className="flex items-center justify-between">
                    <span className="text-ink-secondary">纸张底色</span>
                    <div className="flex gap-1.5">
                      {(
                        [
                          ["default", "默认", "#FFFFFF"],
                          ["ivory", "宣纸", "#FAF6EC"],
                          ["sage", "护眼绿", "#EDF4ED"],
                          ["warm", "羊皮", "#F4ECD8"],
                        ] as const
                      ).map(([k, lbl, hex]) => (
                        <button
                          key={k}
                          type="button"
                          onClick={() => setPrefs((p) => ({ ...p, paper: k }))}
                          title={lbl}
                          className={`h-6 w-6 rounded-full border-2 ${
                            prefs.paper === k
                              ? "border-accent scale-110"
                              : "border-line-strong"
                          }`}
                          style={{ backgroundColor: hex }}
                        />
                      ))}
                    </div>
                  </div>
                )}

                <label className="flex items-center justify-between cursor-pointer pt-1">
                  <span className="text-ink-secondary">中文段落首行缩进</span>
                  <input
                    type="checkbox"
                    checked={prefs.indent}
                    onChange={(e) =>
                      setPrefs((p) => ({ ...p, indent: e.target.checked }))
                    }
                  />
                </label>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Split: Optional TOC Drawer + Reading Canvas */}
      <div className="relative flex flex-1 min-h-0 overflow-hidden">
        {tocOpen && (
          <div className="absolute inset-y-0 left-0 z-20 flex w-72 sm:w-80 flex-col border-r border-line bg-surface shadow-lg md:static md:shadow-none">
            <div className="flex items-center justify-between border-b border-line px-3 py-2">
              <span className="text-xs font-semibold text-ink">
                原书目录（{activeBook.total_chapters} 章）
              </span>
              <button
                type="button"
                onClick={() => setTocOpen(false)}
                className="rounded p-1 text-ink-muted hover:text-ink md:hidden"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="border-b border-line p-2 space-y-2">
              <input
                type="text"
                value={tocFilter}
                onChange={(e) => setTocFilter(e.target.value)}
                placeholder="筛选当前页章节名或章号..."
                className="h-8 w-full rounded-lg border border-line bg-elevated px-2.5 text-xs text-ink outline-none focus:border-accent"
              />
              {volumes.length > 1 && (
                <select
                  value={selectedVolId ?? ""}
                  onChange={(e) => {
                    setSelectedVolId(
                      e.target.value ? Number(e.target.value) : null
                    );
                    setTocPage(1);
                  }}
                  className="h-8 w-full rounded-lg border border-line bg-elevated px-2 text-xs text-ink outline-none focus:border-accent"
                >
                  <option value="">全部分卷</option>
                  {volumes.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.title}（{v.start_chapter}–{v.end_chapter}章）
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
              {filteredTocChapters.map((ch) => {
                const isCur = chapterData?.chapter_num === ch.chapter_num;
                const locked = ch.chapter_num > activeBook.read_progress_ch;
                return (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => {
                      void openChapter(activeBook.id, ch.chapter_num);
                      if (window.innerWidth < 768) setTocOpen(false);
                    }}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition ${
                      isCur
                        ? "bg-accent-soft font-semibold text-accent"
                        : "text-ink-secondary hover:bg-hover hover:text-ink"
                    }`}
                  >
                    <span className="truncate">{ch.title}</span>
                    {locked && (
                      <Lock className="h-3 w-3 shrink-0 text-ink-muted" />
                    )}
                  </button>
                );
              })}
            </div>
            {tocTotal > 100 && (
              <div className="flex items-center justify-between border-t border-line px-3 py-2 text-[11px] text-ink-secondary">
                <button
                  type="button"
                  disabled={tocPage <= 1}
                  onClick={() => setTocPage((p) => Math.max(1, p - 1))}
                  className="rounded border border-line px-2 py-0.5 disabled:opacity-40"
                >
                  上一页
                </button>
                <span className="sl-num">
                  第 {tocPage} / {Math.ceil(tocTotal / 100)} 页
                </span>
                <button
                  type="button"
                  disabled={tocPage >= Math.ceil(tocTotal / 100)}
                  onClick={() => setTocPage((p) => p + 1)}
                  className="rounded border border-line px-2 py-0.5 disabled:opacity-40"
                >
                  下一页
                </button>
              </div>
            )}
          </div>
        )}

        {/* Reading Stage */}
        <div
          ref={contentScrollRef}
          onMouseUp={captureSelection}
          onTouchEnd={captureSelection}
          className="flex-1 overflow-y-auto px-3 sm:px-6 py-5 sm:py-8"
        >
          {loading ? (
            <div className="py-20 text-center text-xs text-ink-muted">
              正在加载章节正文...
            </div>
          ) : !chapterData ? (
            <div className="py-20 text-center space-y-3">
              <BookOpen className="mx-auto h-7 w-7 text-accent" />
              <p className="text-xs text-ink-muted">点击打开第一章开始阅读</p>
              <button
                type="button"
                onClick={() => void openChapter(activeBook.id, 1)}
                className="sl-btn rounded-xl bg-accent px-4 py-2 text-xs font-medium text-accent-fg"
              >
                打开第 1 章
              </button>
            </div>
          ) : (
            <div
              ref={articleRef}
              className={`mx-auto rounded-2xl border border-line px-5 sm:px-10 py-7 sm:py-10 shadow-sm ${WIDTH_CLASSES[prefs.width]} ${paperStyle}`}
            >
              <header className="border-b border-line/70 pb-4 mb-6">
                <div className="text-xs text-ink-muted">
                  {chapterData.volume_title}
                </div>
                <h1 className="mt-1 text-xl sm:text-2xl font-bold tracking-tight">
                  {chapterData.title}
                </h1>
                <div className="sl-num mt-2 flex flex-wrap items-center gap-3 text-[11px] text-ink-muted">
                  <span>第 {chapterData.chapter_num} 章</span>
                  <span>{chapterData.char_count} 字</span>
                  {highlightKeyword && (
                    <span className="rounded bg-warning/20 px-1.5 py-0.5 text-ink">
                      高亮关键词：{highlightKeyword}
                    </span>
                  )}
                </div>
              </header>

              <div
                className={prefs.font === "serif" ? "font-serif" : "font-sans"}
                style={{
                  fontSize: `${prefs.fontSize}px`,
                  lineHeight: prefs.lineHeight,
                }}
              >
                {paragraphs.map((para, idx) => (
                  <p
                    key={idx}
                    className={`mb-4 ${prefs.indent ? "indent-[2em]" : ""}`}
                  >
                    {renderHighlightedParagraph(para, highlightKeyword)}
                  </p>
                ))}
              </div>

              {/* Bottom Chapter Navigation */}
              <footer className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-line/70 pt-5 text-xs">
                <button
                  type="button"
                  disabled={chapterData.chapter_num <= 1}
                  onClick={() =>
                    void openChapter(activeBook.id, chapterData.chapter_num - 1)
                  }
                  className="sl-btn inline-flex h-9 items-center gap-1.5 rounded-xl border border-line bg-elevated px-4 font-medium text-ink disabled:opacity-35"
                >
                  <ChevronLeft className="h-4 w-4" />
                  <span>上一章</span>
                </button>

                {isAheadOfProgress && (
                  <button
                    type="button"
                    onClick={() =>
                      void updateReadProgress(
                        activeBook.id,
                        chapterData.chapter_num
                      )
                    }
                    className="sl-btn inline-flex h-9 items-center gap-1.5 rounded-xl bg-accent-soft px-3.5 font-medium text-accent"
                  >
                    <Lock className="h-3.5 w-3.5" />
                    <span>同步防剧透进度至第 {chapterData.chapter_num} 章</span>
                  </button>
                )}

                <button
                  type="button"
                  disabled={chapterData.chapter_num >= activeBook.total_chapters}
                  onClick={() =>
                    void openChapter(activeBook.id, chapterData.chapter_num + 1)
                  }
                  className="sl-btn inline-flex h-9 items-center gap-1.5 rounded-xl bg-accent px-4 font-medium text-accent-fg disabled:opacity-35"
                >
                  <span>下一章</span>
                  <ChevronRight className="h-4 w-4" />
                </button>
              </footer>
            </div>
          )}
        </div>

        {/* Floating In-Situ Selection Action Bar */}
        {selectedText && chapterData && (
          <div className="sl-animate-pop absolute bottom-5 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1.5 rounded-2xl border border-line-strong bg-surface/95 px-3 py-2 shadow-xl backdrop-blur">
            <span className="hidden sm:inline max-w-[120px] truncate text-[11px] font-medium text-ink-muted pr-1 border-r border-line">
              「{selectedText}」
            </span>
            <button
              type="button"
              onClick={() => openCardGeneratorWithQuery(selectedText)}
              className="sl-btn inline-flex h-7 items-center gap-1 rounded-lg bg-accent-soft px-2.5 text-[11px] font-medium text-accent"
            >
              <UserCheck className="h-3.5 w-3.5" />
              <span>人物/势力卡</span>
            </button>
            <button
              type="button"
              onClick={() =>
                requestNovelQuestion(
                  `请检索「${selectedText}」在已读章节中的首次出场、分布节点与核心背景。`,
                  "verify"
                )
              }
              className="sl-btn inline-flex h-7 items-center gap-1 rounded-lg border border-line bg-elevated px-2.5 text-[11px] font-medium text-ink hover:border-accent"
            >
              <Sparkles className="h-3 w-3 text-accent" />
              <span>查首次出场</span>
            </button>
            <button
              type="button"
              onClick={() =>
                requestNovelQuestion(
                  `请结合第${chapterData.chapter_num}章上下文，解释以下原文并核对相关设定或伏笔：「${selectedText}」`,
                  "verify"
                )
              }
              className="sl-btn inline-flex h-7 items-center gap-1 rounded-lg border border-line bg-elevated px-2.5 text-[11px] font-medium text-ink hover:border-accent"
            >
              <MessageSquare className="h-3 w-3 text-accent" />
              <span>问 AI</span>
            </button>
            <button
              type="button"
              onClick={() => setSelectedText("")}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-ink-muted hover:text-ink"
              aria-label="关闭划词菜单"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
