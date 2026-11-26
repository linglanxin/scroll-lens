import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ChevronLeft,
  ChevronRight,
  Lock,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { booksApi } from "../../api/books";
import { useAppStore } from "../../stores/appStore";
import { useReaderStore } from "../../stores/readerStore";
import type { AliasItem, Volume, WikiNote } from "../../types/api";

export function NovelRightPanel() {
  const {
    selectedBookId,
    books,
    selectedProviderId,
    rightPanelTab,
    setRightPanelTab,
    refreshBooks,
  } = useAppStore();
  const { chapterData, highlightKeyword, loading: readerLoading, openChapter } =
    useReaderStore();

  const activeBook = books.find((b) => b.id === selectedBookId) ?? null;

  const [volumes, setVolumes] = useState<Volume[]>([]);
  const [summarizingRunning, setSummarizingRunning] = useState(false);
  const [aliases, setAliases] = useState<AliasItem[]>([]);
  const [wikiNotes, setWikiNotes] = useState<WikiNote[]>([]);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Alias form
  const [canonicalName, setCanonicalName] = useState("");
  const [aliasCsv, setAliasCsv] = useState("");

  // Wiki form
  const [wikiEntity, setWikiEntity] = useState("");
  const [wikiCategory, setWikiCategory] = useState("人物");
  const [wikiContent, setWikiContent] = useState("");

  // Manual volume split editor (for volume-less books)
  const [showSplitForm, setShowSplitForm] = useState(false);
  const [splitText, setSplitText] = useState("");

  async function loadBookAux(bookId: number) {
    try {
      const [vols, aliasList, wikis, st] = await Promise.all([
        booksApi.listVolumes(bookId),
        booksApi.listAliases(bookId),
        booksApi.listWiki(bookId),
        booksApi.summarizeStatus(bookId),
      ]);
      setVolumes(vols);
      setAliases(aliasList);
      setWikiNotes(wikis);
      setSummarizingRunning(st.running);
    } catch {
      // non-fatal
    }
  }

  useEffect(() => {
    if (selectedBookId) {
      void loadBookAux(selectedBookId);
    } else {
      setVolumes([]);
      setAliases([]);
      setWikiNotes([]);
    }
  }, [selectedBookId, activeBook?.read_progress_ch]);

  useEffect(() => {
    if (!selectedBookId || !summarizingRunning) return;
    const timer = window.setInterval(async () => {
      try {
        const st = await booksApi.summarizeStatus(selectedBookId);
        setSummarizingRunning(st.running);
        const vols = await booksApi.listVolumes(selectedBookId);
        setVolumes(vols);
      } catch {
        // ignore
      }
    }, 2500);
    return () => window.clearInterval(timer);
  }, [selectedBookId, summarizingRunning]);

  if (!activeBook) {
    return (
      <div className="p-4 text-xs text-ink-muted">请先选择一部小说查看分卷与原文。</div>
    );
  }

  async function handleAddAlias() {
    if (!activeBook || !canonicalName.trim()) return;
    const list = aliasCsv
      .split(/[,，、\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    await booksApi.upsertAlias(activeBook.id, canonicalName.trim(), list, true);
    setCanonicalName("");
    setAliasCsv("");
    setStatusMsg("别名已保存并完成 FTS5 重建");
    await loadBookAux(activeBook.id);
  }

  async function handleSaveWiki() {
    if (!activeBook || !wikiEntity.trim() || !wikiContent.trim()) return;
    await booksApi.upsertWiki(activeBook.id, {
      entity_name: wikiEntity.trim(),
      category: wikiCategory,
      content_md: wikiContent.trim(),
      source_chapters: chapterData ? [chapterData.chapter_num] : [],
    });
    setWikiEntity("");
    setWikiContent("");
    setStatusMsg("设定卡片已保存");
    await loadBookAux(activeBook.id);
  }

  async function handleApplySplits() {
    if (!activeBook || !splitText.trim()) return;
    const lines = splitText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const items = lines.map((line) => {
      const [title, range] = line.split(/[:：]/);
      const [s, e] = (range ?? "").split(/[-~]/).map((n) => Number(n.trim()));
      return { title: (title ?? "").trim(), start_chapter: s, end_chapter: e };
    });
    try {
      await booksApi.splitVolumes(activeBook.id, items);
      setShowSplitForm(false);
      setStatusMsg("自定义分卷切分完成");
      await Promise.all([loadBookAux(activeBook.id), refreshBooks()]);
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : "切分失败，请检查区间是否连续");
    }
  }

  function renderHighlightedContent(text: string, kw: string) {
    if (!kw.trim()) return text;
    const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(${escaped})`, "gi");
    const parts = text.split(regex);
    return parts.map((part, idx) =>
      regex.test(part) ? (
        <mark key={idx} className="rounded bg-warning/30 px-0.5 text-ink">
          {part}
        </mark>
      ) : (
        <span key={idx}>{part}</span>
      )
    );
  }

  return (
    <div className="flex h-full flex-col bg-surface">
      {/* Tabs */}
      <div className="grid grid-cols-4 border-b border-line text-xs">
        {(
          [
            ["volumes", "分卷/卷纲"],
            ["reader", "原文阅读"],
            ["aliases", "别名表"],
            ["wiki", "设定本"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setRightPanelTab(key)}
            className={`py-2.5 font-medium border-b-2 transition ${
              rightPanelTab === key
                ? "border-accent text-accent"
                : "border-transparent text-ink-secondary hover:text-ink"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {statusMsg && (
        <div className="flex items-center justify-between border-b border-line bg-accent-soft/50 px-3 py-1.5 text-[11px] text-ink">
          <span>{statusMsg}</span>
          <button type="button" onClick={() => setStatusMsg(null)} className="underline">
            关闭
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3">
        {rightPanelTab === "volumes" && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                {summarizingRunning ? (
                  <button
                    type="button"
                    onClick={async () => {
                      await booksApi.pauseSummarize(activeBook.id);
                      setStatusMsg("已请求暂停卷纲生成");
                    }}
                    className="flex items-center gap-1 rounded-md border border-line bg-elevated px-2.5 py-1 text-xs text-ink"
                  >
                    <Pause className="h-3.5 w-3.5" />
                    <span>暂停</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await booksApi.summarizeAll(activeBook.id, selectedProviderId);
                        setSummarizingRunning(true);
                      } catch (err) {
                        setStatusMsg(err instanceof Error ? err.message : "启动失败");
                      }
                    }}
                    className="flex items-center gap-1 rounded-md bg-accent px-2.5 py-1 text-xs text-accent-fg"
                  >
                    <Play className="h-3.5 w-3.5" />
                    <span>批量生成卷纲</span>
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={() => setShowSplitForm(!showSplitForm)}
                className="text-xs text-ink-secondary underline hover:text-ink"
              >
                手动分卷
              </button>
            </div>

            {showSplitForm && (
              <div className="rounded-lg border border-line bg-elevated p-2.5 space-y-2">
                <p className="text-[11px] text-ink-secondary">
                  每行一卷（格式：卷名:起始章-结束章，需连续覆盖 1–{activeBook.total_chapters}）：
                </p>
                <textarea
                  rows={3}
                  value={splitText}
                  onChange={(e) => setSplitText(e.target.value)}
                  placeholder={"第一卷 萌芽:1-20\n第二卷 星龙阵营:21-88"}
                  className="w-full rounded border border-line bg-surface p-2 text-xs text-ink"
                />
                <button
                  type="button"
                  onClick={() => void handleApplySplits()}
                  className="rounded bg-accent px-2.5 py-1 text-xs text-accent-fg"
                >
                  应用切分
                </button>
              </div>
            )}

            {volumes.map((vol) => (
              <div
                key={vol.id}
                className="rounded-xl border border-line bg-elevated/60 p-3 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-ink">{vol.title}</div>
                    <div className="text-[11px] text-ink-secondary">
                      第 {vol.start_chapter} – {vol.end_chapter} 章
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setRightPanelTab("reader");
                        void openChapter(activeBook.id, vol.start_chapter);
                      }}
                      className="rounded border border-line bg-surface px-2 py-0.5 text-[11px] text-ink-secondary hover:text-ink"
                    >
                      读首章
                    </button>
                    {vol.summary_status !== "ready" && !vol.summary_locked && (
                      <button
                        type="button"
                        disabled={summarizingRunning}
                        onClick={async () => {
                          try {
                            await booksApi.summarizeVolume(
                              activeBook.id,
                              vol.id,
                              selectedProviderId
                            );
                            setSummarizingRunning(true);
                          } catch (err) {
                            setStatusMsg(err instanceof Error ? err.message : "启动失败");
                          }
                        }}
                        className="rounded border border-accent/40 px-2 py-0.5 text-[11px] text-accent hover:bg-accent-soft disabled:opacity-50"
                      >
                        {vol.summary_status === "generating" ? "生成中..." : "生成卷纲"}
                      </button>
                    )}
                  </div>
                </div>

                {vol.summary_progress?.total_chunks && (
                  <div className="text-[11px] text-ink-secondary">
                    分段进度：{vol.summary_progress.completed_chunks ?? 0} /{" "}
                    {vol.summary_progress.total_chunks}
                  </div>
                )}

                {vol.summary_locked ? (
                  <div className="flex items-center gap-1.5 text-[11px] text-ink-muted">
                    <Lock className="h-3 w-3" />
                    <span>超出当前防剧透进度，卷纲已自动隐藏</span>
                  </div>
                ) : vol.summary_md ? (
                  <div className="sl-prose border-t border-line pt-2 text-xs">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {vol.summary_md}
                    </ReactMarkdown>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}

        {rightPanelTab === "reader" && (
          <div>
            {readerLoading ? (
              <p className="py-8 text-center text-xs text-ink-muted">正在加载章节正文...</p>
            ) : !chapterData ? (
              <div className="py-8 text-center space-y-2">
                <p className="text-xs text-ink-muted">
                  点击对话中的 [ch:N] 引用或从分卷列表跳转即可精读原文。
                </p>
                <button
                  type="button"
                  onClick={() => void openChapter(activeBook.id, 1)}
                  className="rounded-md border border-line px-3 py-1 text-xs text-ink hover:bg-hover"
                >
                  打开第 1 章
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-line pb-2">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-ink">{chapterData.title}</div>
                    <div className="text-[11px] text-ink-secondary">
                      {chapterData.volume_title} · {chapterData.char_count} 字
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      disabled={chapterData.chapter_num <= 1}
                      onClick={() =>
                        void openChapter(activeBook.id, chapterData.chapter_num - 1)
                      }
                      className="rounded border border-line p-1 text-ink-secondary hover:bg-hover disabled:opacity-40"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      disabled={chapterData.chapter_num >= activeBook.total_chapters}
                      onClick={() =>
                        void openChapter(activeBook.id, chapterData.chapter_num + 1)
                      }
                      className="rounded border border-line p-1 text-ink-secondary hover:bg-hover disabled:opacity-40"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <div className="whitespace-pre-wrap font-serif text-sm leading-7 text-ink">
                  {renderHighlightedContent(chapterData.content, highlightKeyword)}
                </div>
              </div>
            )}
          </div>
        )}

        {rightPanelTab === "aliases" && (
          <div className="space-y-3">
            <div className="rounded-xl border border-line bg-elevated p-3 space-y-2">
              <div className="text-xs font-semibold text-ink">新增/更新角色或势力别名</div>
              <input
                type="text"
                value={canonicalName}
                onChange={(e) => setCanonicalName(e.target.value)}
                placeholder="主名（如：韩萧）"
                className="w-full rounded border border-line bg-surface px-2.5 py-1.5 text-xs text-ink"
              />
              <input
                type="text"
                value={aliasCsv}
                onChange={(e) => setAliasCsv(e.target.value)}
                placeholder="别名列表，逗号分隔（如：黑星, 黑星阁下）"
                className="w-full rounded border border-line bg-surface px-2.5 py-1.5 text-xs text-ink"
              />
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => void handleAddAlias()}
                  className="flex items-center gap-1 rounded bg-accent px-3 py-1 text-xs text-accent-fg"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>保存并重建索引</span>
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const res = await booksApi.reindexAliases(activeBook.id);
                    setStatusMsg(`已重编 ${res.reindexed_chapters} 章索引`);
                  }}
                  className="flex items-center gap-1 text-xs text-ink-secondary hover:text-ink"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>全书重建</span>
                </button>
              </div>
            </div>

            {aliases.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between rounded-lg border border-line bg-elevated/60 px-3 py-2 text-xs"
              >
                <div>
                  <span className="font-semibold text-ink">{item.canonical_name}</span>
                  <span className="mx-1.5 text-ink-muted">→</span>
                  <span className="text-ink-secondary">{item.aliases.join(" / ")}</span>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    await booksApi.deleteAlias(activeBook.id, item.id);
                    await loadBookAux(activeBook.id);
                  }}
                  className="text-ink-muted hover:text-danger"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {rightPanelTab === "wiki" && (
          <div className="space-y-3">
            <div className="rounded-xl border border-line bg-elevated p-3 space-y-2">
              <div className="text-xs font-semibold text-ink">添加设定卡片</div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={wikiEntity}
                  onChange={(e) => setWikiEntity(e.target.value)}
                  placeholder="实体名称"
                  className="flex-1 rounded border border-line bg-surface px-2.5 py-1.5 text-xs text-ink"
                />
                <select
                  value={wikiCategory}
                  onChange={(e) => setWikiCategory(e.target.value)}
                  className="rounded border border-line bg-surface px-2 py-1.5 text-xs text-ink"
                >
                  {["人物", "军团", "势力", "物品", "事件"].map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <textarea
                rows={3}
                value={wikiContent}
                onChange={(e) => setWikiContent(e.target.value)}
                placeholder="设定描述（支持 Markdown）"
                className="w-full rounded border border-line bg-surface p-2 text-xs text-ink"
              />
              <button
                type="button"
                onClick={() => void handleSaveWiki()}
                className="rounded bg-accent px-3 py-1 text-xs text-accent-fg"
              >
                保存设定卡
              </button>
            </div>

            {wikiNotes.map((note) => (
              <div
                key={note.id}
                className="rounded-xl border border-line bg-elevated/60 p-3 space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-ink">{note.entity_name}</span>
                    <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] text-accent">
                      {note.category}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      await booksApi.deleteWiki(activeBook.id, note.id);
                      await loadBookAux(activeBook.id);
                    }}
                    className="text-ink-muted hover:text-danger"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="sl-prose text-xs">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{note.content_md}</ReactMarkdown>
                </div>
                {note.source_chapters.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {note.source_chapters.map((ch) => (
                      <button
                        key={ch}
                        type="button"
                        onClick={() => {
                          setRightPanelTab("reader");
                          void openChapter(activeBook.id, ch);
                        }}
                        className="rounded border border-line px-1.5 py-0.5 text-[10px] text-ink-secondary hover:border-accent hover:text-accent"
                      >
                        第{ch}章
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
