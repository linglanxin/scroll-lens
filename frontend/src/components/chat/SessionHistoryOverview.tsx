import { useMemo, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  FileText,
  History,
  Loader2,
  Lock,
  MessageSquarePlus,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useAppStore } from "../../stores/appStore";
import { useChatStore } from "../../stores/chatStore";
import type { ChatSession } from "../../types/api";
import { PromptBar } from "./PromptBar";

function formatRelativeTime(iso: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "";
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return "刚刚";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} 小时前`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay} 天前`;
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}-${dd}`;
}

export function SessionHistoryOverview() {
  const {
    mode,
    novelScenario,
    books,
    docs,
    selectedBookId,
    selectedDocId,
    selectedProviderId,
    setActiveView,
  } = useAppStore();

  const {
    sessions,
    isStreaming,
    summarizingIds,
    error,
    selectSession,
    newSession,
    deleteSession,
    summarizeSession,
    sendMessage,
    stopStreaming,
    clearError,
  } = useChatStore();

  const activeBook = books.find((b) => b.id === selectedBookId) ?? null;
  const activeDoc = docs.find((d) => d.id === selectedDocId) ?? null;
  const targetId = mode === "novel" ? selectedBookId : selectedDocId;

  const [searchQuery, setSearchQuery] = useState("");
  const [expandedMap, setExpandedMap] = useState<Record<number, boolean>>({});
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [batchSummarizing, setBatchSummarizing] = useState(false);
  const [draft, setDraft] = useState("");

  const query = searchQuery.trim().toLowerCase();

  const totalQuestions = useMemo(
    () =>
      sessions.reduce(
        (acc, s) => acc + (s.question_count ?? s.questions?.length ?? 0),
        0
      ),
    [sessions]
  );

  const unsummarizedIds = useMemo(
    () =>
      sessions
        .filter(
          (s) =>
            s.summary_source !== "ai" &&
            (s.question_count ?? s.questions?.length ?? 0) > 0
        )
        .map((s) => s.id),
    [sessions]
  );

  const filteredSessions = useMemo(() => {
    if (!query) return sessions;
    return sessions.filter((s) => {
      if ((s.summary ?? "").toLowerCase().includes(query)) return true;
      if ((s.title ?? "").toLowerCase().includes(query)) return true;
      return (s.questions ?? []).some(
        (q) =>
          q.question.toLowerCase().includes(query) ||
          q.answer_preview.toLowerCase().includes(query)
      );
    });
  }, [sessions, query]);

  function isCardExpanded(sess: ChatSession): boolean {
    if (expandedMap[sess.id] !== undefined) {
      return expandedMap[sess.id];
    }
    if (query) {
      return (sess.questions ?? []).some(
        (q) =>
          q.question.toLowerCase().includes(query) ||
          q.answer_preview.toLowerCase().includes(query)
      );
    }
    return false;
  }

  function toggleCard(sessionId: number, currentExpanded: boolean) {
    setExpandedMap((prev) => ({ ...prev, [sessionId]: !currentExpanded }));
  }

  const allExpanded =
    filteredSessions.length > 0 &&
    filteredSessions.every((s) => isCardExpanded(s));

  function toggleAllCards() {
    const targetState = !allExpanded;
    const next: Record<number, boolean> = {};
    for (const s of filteredSessions) {
      next[s.id] = targetState;
    }
    setExpandedMap(next);
  }

  async function handleBatchSummarize() {
    if (batchSummarizing || !selectedProviderId || unsummarizedIds.length === 0) {
      return;
    }
    setBatchSummarizing(true);
    try {
      for (const sid of unsummarizedIds) {
        await summarizeSession(sid, selectedProviderId);
      }
    } finally {
      setBatchSummarizing(false);
    }
  }

  async function handleQuickStartSend() {
    if (!targetId || !draft.trim() || isStreaming) return;
    const text = draft;
    setDraft("");
    newSession();
    await sendMessage({
      mode,
      targetId,
      message: text,
      providerId: selectedProviderId,
      maxChapter: mode === "novel" ? activeBook?.read_progress_ch : null,
      scenario: mode === "novel" ? novelScenario : undefined,
    });
  }

  return (
    <section className="flex flex-1 flex-col min-w-0 min-h-0 bg-canvas">
      {/* Overview Header */}
      <div className="shrink-0 border-b border-line bg-surface/85 px-3 sm:px-6 py-3.5">
        <div className="mx-auto flex max-w-[820px] flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                {mode === "novel" ? (
                  <BookOpen className="h-3.5 w-3.5" />
                ) : (
                  <FileText className="h-3.5 w-3.5" />
                )}
              </span>
              <h1 className="truncate text-[15px] font-semibold text-ink">
                {mode === "novel"
                  ? `《${activeBook?.title ?? ""}》历史对话总览`
                  : `${activeDoc?.filename ?? ""} · 历史对话总览`}
              </h1>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-secondary">
              <span className="sl-num inline-flex items-center gap-1">
                <History className="h-3 w-3 text-ink-muted" />
                <span>
                  共 {sessions.length} 个会话 · {totalQuestions} 个提问
                </span>
              </span>
              {mode === "novel" && activeBook && (
                <span className="sl-num inline-flex items-center gap-1 rounded-md border border-line bg-elevated px-1.5 py-0.5 text-[11px] text-ink-secondary">
                  <Lock className="h-2.5 w-2.5 text-accent" />
                  <span>
                    防剧透锁：第 {activeBook.read_progress_ch}/
                    {activeBook.total_chapters} 章
                  </span>
                </span>
              )}
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {selectedProviderId && unsummarizedIds.length > 0 && (
              <button
                type="button"
                disabled={batchSummarizing}
                onClick={() => void handleBatchSummarize()}
                className="sl-btn inline-flex h-9 items-center gap-1.5 rounded-xl border border-line bg-elevated px-3 text-xs font-medium text-ink-secondary hover:border-accent hover:text-accent disabled:opacity-50"
              >
                {batchSummarizing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5 text-accent" />
                )}
                <span>
                  {batchSummarizing
                    ? "AI 总结中..."
                    : `一键 AI 总结 (${unsummarizedIds.length})`}
                </span>
              </button>
            )}
            <button
              type="button"
              onClick={newSession}
              className="sl-btn inline-flex h-9 items-center gap-1.5 rounded-xl bg-accent px-3.5 text-xs font-medium text-accent-fg"
            >
              <MessageSquarePlus className="h-3.5 w-3.5" />
              <span>新建对话</span>
            </button>
          </div>
        </div>
      </div>

      {/* Scrollable Overview Body */}
      <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4">
        <div className="mx-auto max-w-[820px] space-y-3">
          {/* Search + Expand/Collapse Toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-muted" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索会话总结或曾问过的问题关键词..."
                className="h-9 w-full rounded-xl border border-line bg-surface pl-8 pr-8 text-xs text-ink placeholder:text-ink-muted focus:border-accent focus:outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-ink-muted hover:text-ink"
                  aria-label="清空搜索"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {filteredSessions.length > 0 && (
              <button
                type="button"
                onClick={toggleAllCards}
                className="sl-btn inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-line bg-surface px-3 text-xs font-medium text-ink-secondary hover:border-line-strong hover:text-ink"
              >
                {allExpanded ? (
                  <>
                    <ChevronsDownUp className="h-3.5 w-3.5" />
                    <span>全部折叠</span>
                  </>
                ) : (
                  <>
                    <ChevronsUpDown className="h-3.5 w-3.5" />
                    <span>全部展开问题</span>
                  </>
                )}
              </button>
            )}
          </div>

          {error && (
            <div className="flex items-center justify-between rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-2 text-xs text-danger">
              <span className="truncate">{error}</span>
              <button
                type="button"
                onClick={clearError}
                className="ml-3 shrink-0 underline"
              >
                关闭
              </button>
            </div>
          )}

          {/* Session Cards */}
          {filteredSessions.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line bg-surface px-5 py-10 text-center text-xs text-ink-muted">
              未找到匹配「{searchQuery}」的历史会话或问题
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredSessions.map((sess) => {
                const questions = sess.questions ?? [];
                const qCount = sess.question_count ?? questions.length;
                const expanded = isCardExpanded(sess);
                const isSummarizing = Boolean(summarizingIds[sess.id]);
                const isAiSummary = sess.summary_source === "ai";
                const headline = sess.summary || sess.title;
                const isConfirmDel = confirmDeleteId === sess.id;

                return (
                  <div
                    key={sess.id}
                    className="overflow-hidden rounded-2xl border border-line bg-surface transition hover:border-line-strong"
                  >
                    <div className="p-3.5 sm:p-4">
                      {/* Meta strip */}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                          <span
                            className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-medium ${
                              isAiSummary
                                ? "bg-accent-soft text-accent"
                                : "border border-line bg-elevated text-ink-secondary"
                            }`}
                          >
                            {isAiSummary && <Sparkles className="h-2.5 w-2.5" />}
                            <span>{isAiSummary ? "AI 总结" : "自动摘要"}</span>
                          </span>
                          <span className="sl-num rounded-md bg-elevated px-1.5 py-0.5 font-medium text-ink-secondary">
                            {qCount} 个问题
                          </span>
                          {(sess.total_citations ?? 0) > 0 && (
                            <span className="sl-num rounded-md bg-elevated px-1.5 py-0.5 text-ink-muted">
                              {sess.total_citations} 处引用
                            </span>
                          )}
                        </div>
                        <span className="sl-num text-[11px] text-ink-muted">
                          {formatRelativeTime(sess.updated_at)}
                        </span>
                      </div>

                      {/* Summary headline */}
                      <button
                        type="button"
                        onClick={() => void selectSession(sess.id)}
                        className="mt-2 block w-full text-left focus:outline-none group"
                      >
                        <div className="text-[14px] font-semibold leading-snug text-ink group-hover:text-accent transition-colors">
                          {headline}
                        </div>
                        {qCount > 1 && sess.title && headline !== sess.title && (
                          <div className="mt-1 truncate text-[11px] text-ink-muted">
                            起始问题：{sess.title}
                          </div>
                        )}
                      </button>

                      {/* Card actions row */}
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line/70 pt-2.5">
                        <button
                          type="button"
                          disabled={qCount === 0}
                          onClick={() => toggleCard(sess.id, expanded)}
                          className="sl-btn inline-flex h-8 items-center gap-1 rounded-lg px-2 text-xs font-medium text-ink-secondary hover:bg-hover hover:text-ink disabled:opacity-40"
                        >
                          {expanded ? (
                            <ChevronDown className="h-3.5 w-3.5 text-accent" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5" />
                          )}
                          <span>
                            {qCount === 0
                              ? "暂无问题明细"
                              : expanded
                                ? "收起问题列表"
                                : `展开 ${qCount} 个问题`}
                          </span>
                        </button>

                        <div className="flex items-center gap-1.5">
                          {selectedProviderId && qCount > 0 && (
                            <button
                              type="button"
                              disabled={isSummarizing}
                              onClick={() =>
                                void summarizeSession(sess.id, selectedProviderId)
                              }
                              className="sl-btn inline-flex h-8 items-center gap-1 rounded-lg border border-line bg-elevated px-2.5 text-[11px] font-medium text-ink-secondary hover:border-accent hover:text-accent disabled:opacity-50"
                              title="使用当前模型提炼或刷新本会话总结"
                            >
                              {isSummarizing ? (
                                <Loader2 className="h-3 w-3 animate-spin text-accent" />
                              ) : (
                                <Sparkles className="h-3 w-3 text-accent" />
                              )}
                              <span>
                                {isSummarizing
                                  ? "总结中..."
                                  : isAiSummary
                                    ? "刷新总结"
                                    : "AI 总结"}
                              </span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => void selectSession(sess.id)}
                            className="sl-btn inline-flex h-8 items-center gap-1 rounded-lg bg-accent-soft px-2.5 text-xs font-medium text-accent hover:bg-accent hover:text-accent-fg"
                          >
                            <span>进入对话</span>
                            <ArrowRight className="h-3 w-3" />
                          </button>

                          {isConfirmDel ? (
                            <button
                              type="button"
                              onClick={() => {
                                setConfirmDeleteId(null);
                                void deleteSession(sess.id);
                              }}
                              className="inline-flex h-8 items-center gap-1 rounded-lg bg-danger px-2.5 text-[11px] font-medium text-white"
                            >
                              <Trash2 className="h-3 w-3" />
                              <span>确认删除</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(sess.id)}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-muted hover:bg-hover hover:text-danger"
                              title="删除会话"
                              aria-label="删除会话"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Collapsible Questions Accordion */}
                    {expanded && questions.length > 0 && (
                      <div className="border-t border-line bg-elevated/45 px-3 py-2.5 space-y-1.5">
                        {questions.map((q) => {
                          const highlightedMatch =
                            query.length > 0 &&
                            (q.question.toLowerCase().includes(query) ||
                              q.answer_preview.toLowerCase().includes(query));
                          return (
                            <button
                              key={q.message_id}
                              type="button"
                              onClick={() =>
                                void selectSession(sess.id, q.message_id)
                              }
                              className={`group flex w-full items-start justify-between gap-2.5 rounded-xl border px-3 py-2 text-left transition ${
                                highlightedMatch
                                  ? "border-accent/50 bg-accent-soft/40"
                                  : "border-line/80 bg-surface/85 hover:border-accent/50 hover:bg-surface"
                              }`}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="flex items-start gap-2">
                                  <span className="sl-num mt-0.5 shrink-0 rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                                    Q{q.index}
                                  </span>
                                  <span className="line-clamp-2 text-xs font-medium leading-relaxed text-ink group-hover:text-accent">
                                    {q.question}
                                  </span>
                                </div>
                                {q.answer_preview && (
                                  <p className="mt-1 pl-7 line-clamp-1 text-[11px] text-ink-muted">
                                    {q.answer_preview}
                                  </p>
                                )}
                              </div>
                              <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
                                {q.citations_count > 0 && (
                                  <span className="sl-num rounded bg-elevated px-1.5 py-0.5 text-[10px] text-ink-muted">
                                    {q.citations_count} 引用
                                  </span>
                                )}
                                <ArrowUpRight className="h-3.5 w-3.5 text-ink-muted group-hover:text-accent" />
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Bottom Quick New-Chat Composer */}
      <div className="px-3 sm:px-6 pt-1 pb-[max(1rem,calc(0.75rem+env(safe-area-inset-bottom)))] shrink-0 bg-canvas">
        <PromptBar
          activeBook={activeBook}
          activeDoc={activeDoc}
          draft={draft}
          setDraft={setDraft}
          isStreaming={isStreaming}
          onSend={() => void handleQuickStartSend()}
          onStop={stopStreaming}
          onOpenSettings={() => setActiveView("settings")}
        />
      </div>
    </section>
  );
}
