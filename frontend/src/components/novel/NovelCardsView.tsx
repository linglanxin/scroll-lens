import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  BookOpen,
  Check,
  Compass,
  Edit3,
  Link2,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Tag,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { booksApi } from "../../api/books";
import { useAppStore } from "../../stores/appStore";
import { useReaderStore } from "../../stores/readerStore";
import type {
  DiscoveredEntity,
  NovelCard,
  NovelCardType,
} from "../../types/api";

const TYPE_LABELS: Record<"all" | NovelCardType, string> = {
  all: "全部",
  character: "人物",
  faction: "势力",
  item: "物品",
  world: "世界观",
};

const QUICK_PROMPTS: Array<{
  label: string;
  query: string;
  cardType: NovelCardType;
}> = [
  { label: "主角档案", query: "主角", cardType: "character" },
  { label: "女主档案", query: "女主", cardType: "character" },
  { label: "核心势力", query: "核心势力", cardType: "faction" },
  { label: "主要对手", query: "主要反派", cardType: "character" },
];

export function NovelCardsView() {
  const {
    books,
    selectedBookId,
    selectedProviderId,
    activeCardId,
    openCardInGallery,
    pendingCardQuery,
    clearPendingCardQuery,
    setNovelTab,
    setActiveView,
  } = useAppStore();
  const { openChapter } = useReaderStore();

  const activeBook = books.find((b) => b.id === selectedBookId) ?? null;

  const [cards, setCards] = useState<NovelCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState<"all" | NovelCardType>("all");
  const [searchText, setSearchText] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Create / Generate state
  const [createOpen, setCreateOpen] = useState(false);
  const [queryName, setQueryName] = useState("");
  const [createType, setCreateType] = useState<NovelCardType>("character");
  const [generating, setGenerating] = useState(false);
  const [updatingCardId, setUpdatingCardId] = useState<number | null>(null);
  const [syncingId, setSyncingId] = useState<number | null>(null);

  // Discover state
  const [discovering, setDiscovering] = useState(false);
  const [candidates, setCandidates] = useState<DiscoveredEntity[]>([]);
  const [generatingCandidate, setGeneratingCandidate] = useState<string | null>(null);

  // Edit mode state
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    real_name: "",
    card_type: "character" as NovelCardType,
    role_badge: "",
    aliasesText: "",
    titlesText: "",
    status_summary: "",
    summary: "",
  });
  const [savingEdit, setSavingEdit] = useState(false);

  const loadCards = useCallback(
    async (bookId: number) => {
      setLoading(true);
      try {
        const list = await booksApi.listCards(bookId);
        setCards(list);
        const cur = useAppStore.getState().activeCardId;
        if (list.length > 0 && (!cur || !list.some((c) => c.id === cur))) {
          openCardInGallery(list[0].id);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "加载图鉴失败");
      } finally {
        setLoading(false);
      }
    },
    [openCardInGallery]
  );

  useEffect(() => {
    setCandidates([]);
    setNotice(null);
    setError(null);
    setEditing(false);
    if (selectedBookId) {
      void loadCards(selectedBookId);
    } else {
      setCards([]);
    }
  }, [selectedBookId, activeBook?.read_progress_ch, loadCards]);

  // Handle cross-view handoff (e.g. from Chat or Reader text selection)
  useEffect(() => {
    if (!pendingCardQuery) return;
    const q = pendingCardQuery.trim();
    clearPendingCardQuery();
    if (!q) return;

    const lower = q.toLowerCase();
    const matched = cards.find(
      (c) =>
        c.real_name.toLowerCase() === lower ||
        c.aliases.some((a) => a.toLowerCase() === lower) ||
        c.titles.some((t) => t.toLowerCase() === lower)
    );
    if (matched) {
      openCardInGallery(matched.id);
      setCreateOpen(false);
      return;
    }
    setQueryName(q);
    setCreateOpen(true);
  }, [pendingCardQuery, cards, clearPendingCardQuery, openCardInGallery]);

  const filteredCards = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return cards.filter((c) => {
      if (typeFilter !== "all" && c.card_type !== typeFilter) return false;
      if (!q) return true;
      return (
        c.real_name.toLowerCase().includes(q) ||
        c.role_badge.toLowerCase().includes(q) ||
        c.aliases.some((a) => a.toLowerCase().includes(q)) ||
        c.titles.some((t) => t.toLowerCase().includes(q)) ||
        c.status_summary.toLowerCase().includes(q)
      );
    });
  }, [cards, typeFilter, searchText]);

  const selectedCard = useMemo(
    () =>
      filteredCards.find((c) => c.id === activeCardId) ??
      cards.find((c) => c.id === activeCardId) ??
      filteredCards[0] ??
      null,
    [filteredCards, cards, activeCardId]
  );

  useEffect(() => {
    setEditing(false);
  }, [selectedCard?.id]);

  if (!activeBook) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-xs text-ink-muted">
        请先选择一部小说查看人物与势力图鉴。
      </div>
    );
  }

  async function handleGenerate(
    targetName: string,
    targetType: NovelCardType = createType
  ) {
    if (!activeBook || !targetName.trim() || generating) return;
    setGenerating(true);
    setError(null);
    setNotice(null);
    try {
      const created = await booksApi.generateCard(activeBook.id, {
        query_name: targetName.trim(),
        card_type: targetType,
        provider_id: selectedProviderId,
        max_chapter: activeBook.read_progress_ch || activeBook.total_chapters,
      });
      await loadCards(activeBook.id);
      openCardInGallery(created.id);
      setCreateOpen(false);
      setQueryName("");
      setNotice(`已生成「${created.real_name}」档案卡（截至第 ${created.as_of_chapter} 章）`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成档案卡失败");
    } finally {
      setGenerating(false);
      setGeneratingCandidate(null);
    }
  }

  async function handleIncrementalUpdate(card: NovelCard) {
    if (!activeBook || updatingCardId) return;
    setUpdatingCardId(card.id);
    setError(null);
    setNotice(null);
    try {
      const updated = await booksApi.generateCard(activeBook.id, {
        query_name: card.real_name,
        card_type: card.card_type,
        provider_id: selectedProviderId,
        max_chapter: activeBook.read_progress_ch || activeBook.total_chapters,
        card_id: card.id,
      });
      await loadCards(activeBook.id);
      openCardInGallery(updated.id);
      setNotice(`已将「${updated.real_name}」增量更新至第 ${updated.as_of_chapter} 章`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "增量更新失败");
    } finally {
      setUpdatingCardId(null);
    }
  }

  async function handleDiscover() {
    if (!activeBook || discovering) return;
    setDiscovering(true);
    setError(null);
    try {
      const res = await booksApi.discoverCards(activeBook.id, {
        provider_id: selectedProviderId,
        max_chapter: activeBook.read_progress_ch || activeBook.total_chapters,
      });
      setCandidates(res.candidates);
      if (res.candidates.length === 0) {
        setNotice("暂未识别出候选对象，可手动输入名称生成。");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "识别核心人物失败");
    } finally {
      setDiscovering(false);
    }
  }

  async function handleSyncAliases(card: NovelCard) {
    if (!activeBook || syncingId) return;
    setSyncingId(card.id);
    setError(null);
    try {
      const res = await booksApi.syncCardAliases(activeBook.id, card.id);
      setNotice(
        `已将「${res.canonical_name}」的 ${res.aliases.length} 个别名同步至别名表，并重建 ${res.reindexed_chapters} 章索引`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "同步别名失败");
    } finally {
      setSyncingId(null);
    }
  }

  function startEdit(card: NovelCard) {
    setEditForm({
      real_name: card.real_name,
      card_type: card.card_type,
      role_badge: card.role_badge,
      aliasesText: card.aliases.join("，"),
      titlesText: card.titles.join("，"),
      status_summary: card.status_summary,
      summary: card.summary,
    });
    setEditing(true);
  }

  async function handleSaveEdit(card: NovelCard) {
    if (!activeBook || !editForm.real_name.trim() || savingEdit) return;
    setSavingEdit(true);
    setError(null);
    try {
      const splitTokens = (raw: string) =>
        raw
          .split(/[,，、\n]+/)
          .map((s) => s.trim())
          .filter(Boolean);
      const updated = await booksApi.updateCard(activeBook.id, card.id, {
        real_name: editForm.real_name.trim(),
        card_type: editForm.card_type,
        role_badge: editForm.role_badge.trim(),
        aliases: splitTokens(editForm.aliasesText),
        titles: splitTokens(editForm.titlesText),
        status_summary: editForm.status_summary.trim(),
        summary: editForm.summary.trim(),
      });
      setCards((prev) => prev.map((c) => (c.id === card.id ? updated : c)));
      setEditing(false);
      setNotice(`已保存「${updated.real_name}」的修改`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存修改失败");
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDelete(card: NovelCard) {
    if (!activeBook) return;
    try {
      await booksApi.deleteCard(activeBook.id, card.id);
      const rest = cards.filter((c) => c.id !== card.id);
      setCards(rest);
      openCardInGallery(rest[0]?.id ?? null);
      setNotice(`已删除「${card.real_name}」`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    }
  }

  function jumpToChapter(chapterNum: number, keyword: string) {
    if (!activeBook || chapterNum <= 0) return;
    setNovelTab("reader");
    void openChapter(activeBook.id, chapterNum, keyword);
  }

  function handleRelationClick(targetName: string) {
    const lower = targetName.trim().toLowerCase();
    const existing = cards.find(
      (c) =>
        c.real_name.toLowerCase() === lower ||
        c.aliases.some((a) => a.toLowerCase() === lower)
    );
    if (existing) {
      openCardInGallery(existing.id);
    } else {
      setQueryName(targetName);
      setCreateOpen(true);
    }
  }

  const progressBehind =
    selectedCard && activeBook.read_progress_ch > selectedCard.as_of_chapter
      ? activeBook.read_progress_ch - selectedCard.as_of_chapter
      : 0;

  const maxBucketOcc =
    selectedCard?.activity?.buckets.reduce(
      (m, b) => Math.max(m, b.occurrences),
      0
    ) ?? 0;

  return (
    <section className="flex flex-1 flex-col min-w-0 min-h-0 bg-canvas">
      {/* Top Toolbar */}
      <div className="shrink-0 border-b border-line bg-surface/90 px-3 sm:px-5 py-2.5">
        <div className="mx-auto flex max-w-[1040px] flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {(["all", "character", "faction", "item", "world"] as const).map(
              (key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTypeFilter(key)}
                  className={`sl-btn h-8 rounded-lg px-2.5 text-xs font-medium transition ${
                    typeFilter === key
                      ? "bg-accent-soft text-accent"
                      : "text-ink-secondary hover:bg-hover hover:text-ink"
                  }`}
                >
                  {TYPE_LABELS[key]}
                </button>
              )
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted" />
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="搜真名 / 别名 / 称呼..."
                className="h-8 w-40 sm:w-48 rounded-lg border border-line bg-elevated pl-8 pr-2.5 text-xs text-ink outline-none focus:border-accent"
              />
            </div>

            <button
              type="button"
              disabled={discovering || !selectedProviderId}
              onClick={() => void handleDiscover()}
              className="sl-btn inline-flex h-8 items-center gap-1 rounded-lg border border-line bg-elevated px-2.5 text-xs font-medium text-ink-secondary hover:border-accent hover:text-accent disabled:opacity-45"
              title="从已读章节自动发现核心角色与势力"
            >
              {discovering ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
              ) : (
                <Compass className="h-3.5 w-3.5 text-accent" />
              )}
              <span>{discovering ? "发现中..." : "发现核心人物"}</span>
            </button>

            <button
              type="button"
              onClick={() => setCreateOpen(!createOpen)}
              className="sl-btn inline-flex h-8 items-center gap-1 rounded-lg bg-accent px-3 text-xs font-medium text-accent-fg"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>生成档案卡</span>
            </button>
          </div>
        </div>

        {/* Create / Quick Generate Bar */}
        {createOpen && (
          <div className="mx-auto mt-2.5 max-w-[1040px] rounded-xl border border-line-strong bg-elevated/70 p-3 space-y-2.5">
            {!selectedProviderId ? (
              <div className="flex items-center justify-between text-xs text-ink-secondary">
                <span>生成档案卡需要先配置大模型 API Key。</span>
                <button
                  type="button"
                  onClick={() => setActiveView("settings")}
                  className="text-accent underline"
                >
                  前往配置
                </button>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={queryName}
                    onChange={(e) => setQueryName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        void handleGenerate(queryName, createType);
                      }
                    }}
                    placeholder="输入人名、势力名或“主角 / 女主”..."
                    className="h-9 flex-1 min-w-[180px] rounded-lg border border-line bg-surface px-3 text-xs text-ink outline-none focus:border-accent"
                  />
                  <select
                    value={createType}
                    onChange={(e) =>
                      setCreateType(e.target.value as NovelCardType)
                    }
                    className="h-9 rounded-lg border border-line bg-surface px-2.5 text-xs text-ink outline-none focus:border-accent"
                  >
                    <option value="character">人物</option>
                    <option value="faction">势力</option>
                    <option value="item">物品</option>
                    <option value="world">世界观</option>
                  </select>
                  <button
                    type="button"
                    disabled={generating || !queryName.trim()}
                    onClick={() => void handleGenerate(queryName, createType)}
                    className="sl-btn inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-4 text-xs font-medium text-accent-fg disabled:opacity-45"
                  >
                    {generating ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" />
                    )}
                    <span>
                      {generating
                        ? `正在查证第 1–${activeBook.read_progress_ch} 章...`
                        : "立即生成"}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreateOpen(false)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-ink-muted hover:bg-hover"
                    aria-label="收起"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className="text-ink-muted">一键快捷：</span>
                  {QUICK_PROMPTS.map((qp) => (
                    <button
                      key={qp.label}
                      type="button"
                      disabled={generating}
                      onClick={() => {
                        setQueryName(qp.query);
                        setCreateType(qp.cardType);
                        void handleGenerate(qp.query, qp.cardType);
                      }}
                      className="rounded-md border border-line bg-surface px-2 py-0.5 text-ink-secondary hover:border-accent hover:text-accent disabled:opacity-50"
                    >
                      {qp.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* Discovered Candidates Strip */}
        {candidates.length > 0 && (
          <div className="mx-auto mt-2.5 max-w-[1040px] rounded-xl border border-line bg-elevated/60 p-3 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-ink">
                从已读内容发现的核心人物与势力（点击一键建卡）
              </span>
              <button
                type="button"
                onClick={() => setCandidates([])}
                className="text-[11px] text-ink-muted hover:text-ink"
              >
                收起
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
              {candidates.map((cand) => {
                const isGen = generatingCandidate === cand.name;
                return (
                  <button
                    key={cand.name}
                    type="button"
                    disabled={generating}
                    onClick={() => {
                      if (cand.existing_card_id) {
                        openCardInGallery(cand.existing_card_id);
                      } else {
                        setGeneratingCandidate(cand.name);
                        void handleGenerate(cand.name, cand.card_type);
                      }
                    }}
                    className="sl-btn flex flex-col justify-between rounded-xl border border-line bg-surface p-2.5 text-left hover:border-accent disabled:opacity-60"
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="truncate text-xs font-semibold text-ink">
                        {cand.name}
                      </span>
                      <span className="shrink-0 rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent">
                        {cand.existing_card_id
                          ? "已建卡"
                          : isGen
                            ? "生成中..."
                            : cand.role_badge || TYPE_LABELS[cand.card_type]}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[11px] text-ink-muted">
                      {cand.reason}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Notices / Errors */}
      {(notice || error) && (
        <div className="mx-auto w-full max-w-[1040px] px-3 sm:px-5 pt-2.5 shrink-0 space-y-1.5">
          {notice && (
            <div className="flex items-center justify-between rounded-xl border border-accent/30 bg-accent-soft/60 px-3.5 py-2 text-xs text-ink">
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
          {error && (
            <div className="flex items-center justify-between rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-2 text-xs text-danger">
              <span className="truncate">{error}</span>
              <button
                type="button"
                onClick={() => setError(null)}
                className="ml-2 shrink-0 underline"
              >
                关闭
              </button>
            </div>
          )}
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-5 py-4">
        <div className="mx-auto max-w-[1040px] h-full">
          {loading && cards.length === 0 ? (
            <div className="flex py-20 items-center justify-center gap-2 text-xs text-ink-muted">
              <Loader2 className="h-4 w-4 animate-spin text-accent" />
              <span>正在加载图鉴档案...</span>
            </div>
          ) : cards.length === 0 ? (
            <div className="mx-auto mt-6 max-w-lg rounded-2xl border border-dashed border-line-strong bg-surface p-7 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                <Users className="h-6 w-6" />
              </div>
              <h2 className="mt-4 text-base font-semibold text-ink">
                《{activeBook.title}》人物与势力图鉴
              </h2>
              <p className="mt-1.5 text-xs leading-relaxed text-ink-secondary">
                严格锁定在当前已读进度（第 {activeBook.read_progress_ch} 章）内，整理角色的真名、别名、称呼、当前地位、戏份热区与成长发展轨迹。
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {QUICK_PROMPTS.map((qp) => (
                  <button
                    key={qp.label}
                    type="button"
                    disabled={generating || !selectedProviderId}
                    onClick={() => void handleGenerate(qp.query, qp.cardType)}
                    className="sl-btn inline-flex h-9 items-center gap-1.5 rounded-xl border border-line bg-elevated px-3.5 text-xs font-medium text-ink hover:border-accent disabled:opacity-50"
                  >
                    <Sparkles className="h-3.5 w-3.5 text-accent" />
                    <span>生成{qp.label}</span>
                  </button>
                ))}
                <button
                  type="button"
                  disabled={discovering || !selectedProviderId}
                  onClick={() => void handleDiscover()}
                  className="sl-btn inline-flex h-9 items-center gap-1.5 rounded-xl bg-accent px-4 text-xs font-medium text-accent-fg disabled:opacity-50"
                >
                  <Compass className="h-3.5 w-3.5" />
                  <span>自动发现核心人物</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-[290px_1fr] gap-4 items-start">
              {/* Left Card Index */}
              <div className="space-y-1.5 lg:sticky lg:top-0">
                {filteredCards.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-line bg-surface p-4 text-center text-xs text-ink-muted">
                    没有匹配的档案卡
                  </div>
                ) : (
                  filteredCards.map((card) => {
                    const active = selectedCard?.id === card.id;
                    const needsUpdate =
                      activeBook.read_progress_ch > card.as_of_chapter;
                    return (
                      <button
                        key={card.id}
                        type="button"
                        onClick={() => openCardInGallery(card.id)}
                        className={`sl-btn w-full rounded-xl border p-3 text-left transition ${
                          active
                            ? "border-accent bg-surface shadow-sm"
                            : "border-line bg-surface/70 hover:border-line-strong hover:bg-surface"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-[13.5px] font-semibold text-ink">
                            {card.real_name}
                          </span>
                          <span className="shrink-0 rounded-md bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent">
                            {card.role_badge || TYPE_LABELS[card.card_type]}
                          </span>
                        </div>
                        {card.aliases.length > 0 && (
                          <div className="mt-1 truncate text-[11px] text-ink-muted">
                            别名：{card.aliases.slice(0, 3).join(" · ")}
                          </div>
                        )}
                        <div className="mt-1.5 flex items-center justify-between gap-2 text-[10.5px] text-ink-muted">
                          <span className="sl-num">
                            截至第 {card.as_of_chapter} 章
                          </span>
                          {needsUpdate && (
                            <span className="rounded bg-elevated px-1.5 py-0.5 text-accent">
                              +{activeBook.read_progress_ch - card.as_of_chapter}章可更新
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>

              {/* Right Detailed Profile Card */}
              {selectedCard && (
                <article className="rounded-2xl border border-line bg-surface p-4 sm:p-6 space-y-5">
                  {editing ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between border-b border-line pb-2.5">
                        <h3 className="text-sm font-semibold text-ink">
                          编辑档案卡
                        </h3>
                        <button
                          type="button"
                          onClick={() => setEditing(false)}
                          className="text-xs text-ink-muted hover:text-ink"
                        >
                          取消
                        </button>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                        <div>
                          <label className="mb-1 block text-ink-secondary">真名</label>
                          <input
                            type="text"
                            value={editForm.real_name}
                            onChange={(e) =>
                              setEditForm({ ...editForm, real_name: e.target.value })
                            }
                            className="h-9 w-full rounded-lg border border-line bg-elevated px-2.5 text-ink outline-none focus:border-accent"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-ink-secondary">定位徽章</label>
                          <input
                            type="text"
                            value={editForm.role_badge}
                            onChange={(e) =>
                              setEditForm({ ...editForm, role_badge: e.target.value })
                            }
                            className="h-9 w-full rounded-lg border border-line bg-elevated px-2.5 text-ink outline-none focus:border-accent"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-ink-secondary">类别</label>
                          <select
                            value={editForm.card_type}
                            onChange={(e) =>
                              setEditForm({
                                ...editForm,
                                card_type: e.target.value as NovelCardType,
                              })
                            }
                            className="h-9 w-full rounded-lg border border-line bg-elevated px-2.5 text-ink outline-none focus:border-accent"
                          >
                            <option value="character">人物</option>
                            <option value="faction">势力</option>
                            <option value="item">物品</option>
                            <option value="world">世界观</option>
                          </select>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                        <div>
                          <label className="mb-1 block text-ink-secondary">
                            别名/化名（逗号分隔）
                          </label>
                          <input
                            type="text"
                            value={editForm.aliasesText}
                            onChange={(e) =>
                              setEditForm({ ...editForm, aliasesText: e.target.value })
                            }
                            className="h-9 w-full rounded-lg border border-line bg-elevated px-2.5 text-ink outline-none focus:border-accent"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-ink-secondary">
                            称呼/尊称/官职（逗号分隔）
                          </label>
                          <input
                            type="text"
                            value={editForm.titlesText}
                            onChange={(e) =>
                              setEditForm({ ...editForm, titlesText: e.target.value })
                            }
                            className="h-9 w-full rounded-lg border border-line bg-elevated px-2.5 text-ink outline-none focus:border-accent"
                          />
                        </div>
                      </div>
                      <div className="text-xs">
                        <label className="mb-1 block text-ink-secondary">
                          当前身份与地位
                        </label>
                        <input
                          type="text"
                          value={editForm.status_summary}
                          onChange={(e) =>
                            setEditForm({
                              ...editForm,
                              status_summary: e.target.value,
                            })
                          }
                          className="h-9 w-full rounded-lg border border-line bg-elevated px-2.5 text-ink outline-none focus:border-accent"
                        />
                      </div>
                      <div className="text-xs">
                        <label className="mb-1 block text-ink-secondary">简介</label>
                        <textarea
                          rows={3}
                          value={editForm.summary}
                          onChange={(e) =>
                            setEditForm({ ...editForm, summary: e.target.value })
                          }
                          className="w-full rounded-lg border border-line bg-elevated p-2.5 text-ink outline-none focus:border-accent"
                        />
                      </div>
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setEditing(false)}
                          className="h-8 rounded-lg border border-line px-3 text-xs text-ink-secondary"
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          disabled={savingEdit}
                          onClick={() => void handleSaveEdit(selectedCard)}
                          className="sl-btn inline-flex h-8 items-center gap-1 rounded-lg bg-accent px-3.5 text-xs font-medium text-accent-fg"
                        >
                          <Check className="h-3.5 w-3.5" />
                          <span>{savingEdit ? "保存中..." : "保存修改"}</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* 1. Identity Header */}
                      <div className="border-b border-line pb-4 space-y-3">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h2 className="text-xl font-bold tracking-tight text-ink">
                                {selectedCard.real_name}
                              </h2>
                              <span className="rounded-lg bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
                                {selectedCard.role_badge ||
                                  TYPE_LABELS[selectedCard.card_type]}
                              </span>
                              <span className="sl-num inline-flex items-center gap-1 rounded-lg border border-line bg-elevated px-2 py-0.5 text-[11px] text-ink-secondary">
                                <Lock className="h-3 w-3 text-accent" />
                                <span>截至第 {selectedCard.as_of_chapter} 章</span>
                              </span>
                            </div>
                            {selectedCard.status_summary && (
                              <p className="text-[13px] font-medium text-ink-secondary">
                                {selectedCard.status_summary}
                              </p>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5">
                            {progressBehind > 0 && selectedProviderId && (
                              <button
                                type="button"
                                disabled={updatingCardId === selectedCard.id}
                                onClick={() =>
                                  void handleIncrementalUpdate(selectedCard)
                                }
                                className="sl-btn inline-flex h-8 items-center gap-1 rounded-lg border border-accent/40 bg-accent-soft/70 px-2.5 text-xs font-medium text-accent disabled:opacity-50"
                              >
                                <RefreshCw
                                  className={`h-3.5 w-3.5 ${
                                    updatingCardId === selectedCard.id
                                      ? "animate-spin"
                                      : ""
                                  }`}
                                />
                                <span>
                                  {updatingCardId === selectedCard.id
                                    ? "增量更新中..."
                                    : `更新至第 ${activeBook.read_progress_ch} 章`}
                                </span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => startEdit(selectedCard)}
                              className="sl-btn inline-flex h-8 items-center gap-1 rounded-lg border border-line bg-elevated px-2.5 text-xs text-ink-secondary hover:text-ink"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                              <span>编辑</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDelete(selectedCard)}
                              className="sl-btn inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-elevated text-ink-muted hover:text-danger"
                              title="删除档案卡"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>

                        {/* Aliases & Titles */}
                        {(selectedCard.aliases.length > 0 ||
                          selectedCard.titles.length > 0) && (
                          <div className="flex flex-wrap items-center gap-1.5 text-xs">
                            {selectedCard.aliases.map((al) => (
                              <span
                                key={`al-${al}`}
                                className="inline-flex items-center gap-1 rounded-md border border-line bg-elevated px-2 py-0.5 text-[11px] text-ink-secondary"
                              >
                                <Tag className="h-2.5 w-2.5 text-ink-muted" />
                                <span>{al}</span>
                              </span>
                            ))}
                            {selectedCard.titles.map((tl) => (
                              <span
                                key={`tl-${tl}`}
                                className="rounded-md border border-line/70 bg-canvas px-2 py-0.5 text-[11px] text-ink-muted"
                              >
                                {tl}
                              </span>
                            ))}
                            <button
                              type="button"
                              disabled={syncingId === selectedCard.id}
                              onClick={() => void handleSyncAliases(selectedCard)}
                              className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium text-accent hover:bg-accent-soft"
                              title="将这些别名同步到本书别名映射表并重建全文检索索引"
                            >
                              <Link2 className="h-3 w-3" />
                              <span>
                                {syncingId === selectedCard.id
                                  ? "同步中..."
                                  : "同步至别名表"}
                              </span>
                            </button>
                          </div>
                        )}

                        {selectedCard.summary && (
                          <p className="text-[13.5px] leading-relaxed text-ink">
                            {selectedCard.summary}
                          </p>
                        )}
                      </div>

                      {/* Zero-cost FTS5 Activity Strip */}
                      {selectedCard.activity &&
                        selectedCard.activity.matching_chapters > 0 && (
                          <div className="rounded-xl border border-line bg-elevated/45 p-3 space-y-2">
                            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-ink-secondary">
                              <span className="font-medium text-ink">
                                已读进度戏份分布
                              </span>
                              <span className="sl-num">
                                首次 第 {selectedCard.activity.first_chapter} 章 ·
                                末次 第 {selectedCard.activity.last_chapter} 章 ·
                                共 {selectedCard.activity.matching_chapters} 章提及
                              </span>
                            </div>
                            <div className="flex h-6 items-end gap-1">
                              {selectedCard.activity.buckets.map((b, i) => {
                                const ratio =
                                  maxBucketOcc > 0
                                    ? Math.max(0.12, b.occurrences / maxBucketOcc)
                                    : 0.12;
                                return (
                                  <div
                                    key={i}
                                    className="flex-1 rounded-sm bg-accent/70 transition-all"
                                    style={{
                                      height: `${
                                        b.occurrences > 0
                                          ? Math.round(ratio * 100)
                                          : 10
                                      }%`,
                                      opacity: b.occurrences > 0 ? 0.85 : 0.16,
                                    }}
                                    title={`第 ${b.start_ch}–${b.end_ch} 章：${b.matching_chapters} 章 / ${b.occurrences} 次`}
                                  />
                                );
                              })}
                            </div>
                          </div>
                        )}

                      {/* 2. Genre-Adaptive Attributes */}
                      {selectedCard.attributes.length > 0 && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          {selectedCard.attributes.map((attr, idx) => (
                            <div
                              key={idx}
                              className="rounded-xl border border-line bg-elevated/40 px-3.5 py-2.5"
                            >
                              <div className="text-[11px] font-medium text-ink-muted">
                                {attr.label}
                              </div>
                              <div className="mt-0.5 text-[13px] font-medium text-ink">
                                {attr.value}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* 3. Development Trajectory Timeline */}
                      <div className="space-y-2.5">
                        <div className="flex items-center justify-between">
                          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
                            发展轨迹
                          </h3>
                          {selectedCard.spoiler_hidden_count > 0 && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-ink-muted">
                              <Lock className="h-3 w-3 text-accent" />
                              <span>
                                已折叠 {selectedCard.spoiler_hidden_count} 个超出当前进度的后续阶段
                              </span>
                            </span>
                          )}
                        </div>

                        {selectedCard.timeline.length === 0 ? (
                          <p className="text-xs text-ink-muted">
                            当前阅读进度内暂无阶段轨迹记录。
                          </p>
                        ) : (
                          <div className="relative space-y-3 pl-4 before:absolute before:left-[5px] before:top-2 before:bottom-2 before:w-px before:bg-line-strong">
                            {selectedCard.timeline.map((item, idx) => (
                              <div key={idx} className="relative">
                                <span className="absolute -left-[15px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-accent bg-surface" />
                                <div className="rounded-xl border border-line bg-elevated/35 p-3">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <span className="text-[13px] font-semibold text-ink">
                                      {item.stage}
                                    </span>
                                    {item.anchor_chapter > 0 && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          jumpToChapter(
                                            item.anchor_chapter,
                                            selectedCard.real_name
                                          )
                                        }
                                        className="sl-num inline-flex items-center gap-1 rounded-md bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent hover:underline"
                                      >
                                        <BookOpen className="h-3 w-3" />
                                        <span>
                                          {item.chapter_range ||
                                            `第${item.anchor_chapter}章`}
                                        </span>
                                      </button>
                                    )}
                                  </div>
                                  <p className="mt-1.5 text-xs leading-relaxed text-ink-secondary">
                                    {item.event}
                                  </p>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* 4. Relations */}
                      {selectedCard.relations.length > 0 && (
                        <div className="border-t border-line pt-4 space-y-2">
                          <h3 className="text-xs font-semibold text-ink-secondary">
                            关联人物与势力（点击跳转或建卡）
                          </h3>
                          <div className="flex flex-wrap gap-2">
                            {selectedCard.relations.map((rel, idx) => (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => handleRelationClick(rel.target)}
                                className="sl-btn inline-flex items-center gap-1.5 rounded-xl border border-line bg-elevated/60 px-3 py-1.5 text-xs hover:border-accent"
                              >
                                <span className="font-semibold text-ink">
                                  {rel.target}
                                </span>
                                <span className="text-ink-muted">·</span>
                                <span className="text-ink-secondary">
                                  {rel.relation}
                                </span>
                                <ArrowUpRight className="h-3 w-3 text-accent" />
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </article>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
