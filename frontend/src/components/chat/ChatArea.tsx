import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  FileText,
  Loader2,
  MessageSquarePlus,
  ScanEye,
  Sparkles,
  Upload,
  Wrench,
} from "lucide-react";
import { documentsApi } from "../../api/documents";
import { useAppStore } from "../../stores/appStore";
import { useChatStore } from "../../stores/chatStore";
import { useReaderStore } from "../../stores/readerStore";
import type { ChatMessage, Citation, ToolTraceItem } from "../../types/api";
import { BrandLogo } from "../common/BrandLogo";
import {
  DOC_ACCEPT,
  DOC_FORMAT_BADGES,
  NOVEL_ACCEPT,
  NOVEL_FORMAT_BADGES,
} from "../common/fileFormats";
import { PromptBar } from "./PromptBar";
import { SessionHistoryOverview } from "./SessionHistoryOverview";

function injectCitationLinks(markdown: string): string {
  return markdown
    .replace(/\[ch:(\d+)\]/g, "[第$1章](#sl-ch-$1)")
    .replace(/\[p:(\d+)\]/g, "[P$1](#sl-p-$1)");
}

function summarizePreviewText(text: string, maxLen = 90): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= maxLen) return cleaned;
  return `${cleaned.slice(0, maxLen - 1).trimEnd()}…`;
}

interface QATurn {
  index: number;
  userMsg: ChatMessage;
  assistantMsg: ChatMessage | null;
}

function buildQATurns(messages: ChatMessage[]): {
  turns: QATurn[];
  orphanMessages: ChatMessage[];
} {
  const turns: QATurn[] = [];
  const orphanMessages: ChatMessage[] = [];
  let current: QATurn | null = null;

  for (const m of messages) {
    if (m.role === "user") {
      current = {
        index: turns.length + 1,
        userMsg: m,
        assistantMsg: null,
      };
      turns.push(current);
    } else if (m.role === "assistant" && current && !current.assistantMsg) {
      current.assistantMsg = m;
      current = null;
    } else {
      orphanMessages.push(m);
    }
  }
  return { turns, orphanMessages };
}

function ToolTraceCapsule({ trace }: { trace: ToolTraceItem[] }) {
  const [open, setOpen] = useState(false);
  if (trace.length === 0) return null;
  const running = trace.some((t) => t.status === "running");
  const lastTool = trace[trace.length - 1];

  return (
    <div className="mb-3 overflow-hidden rounded-xl border border-line bg-elevated/70 text-xs">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-ink-secondary hover:text-ink"
      >
        <span className="flex items-center gap-2 min-w-0">
          {running ? (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" />
          ) : (
            <Wrench className="h-3.5 w-3.5 shrink-0 text-accent" />
          )}
          <span className="truncate font-medium">
            {running
              ? `正在查证原文（第 ${lastTool?.round ?? 1} 轮 · ${lastTool?.tool ?? "检索"}）...`
              : `已完成 ${trace.length} 步检索查证`}
          </span>
        </span>
        <span className="flex items-center gap-1.5 shrink-0 text-[11px] text-ink-muted">
          {!running && lastTool?.total_tool_chars !== undefined && (
            <span className="sl-num">{lastTool.total_tool_chars} 字</span>
          )}
          {open ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </span>
      </button>

      {open && (
        <div className="border-t border-line bg-surface/60 px-3 py-2 space-y-1.5 font-mono text-[11px] text-ink-secondary">
          {trace.map((item, idx) => (
            <div key={idx} className="flex items-center justify-between gap-2">
              <span className="truncate">
                <span className="text-ink font-medium">{item.tool ?? item.mode ?? "step"}</span>{" "}
                {item.arguments ? JSON.stringify(item.arguments) : ""}
              </span>
              <span className="sl-num shrink-0 flex items-center gap-1 text-ink-muted">
                {item.result_chars !== undefined && `${item.result_chars} 字`}
                {item.status !== "running" && (
                  <CheckCircle2 className="h-3 w-3 text-success" />
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const NOVEL_STARTERS = [
  "梳理当前已读进度的主线阶段与核心转折，附上章节引用",
  "主角目前掌握了哪些核心能力或势力资源？",
  "检索一个关键配角在已读章节中的首次出场与后续去向",
];

const DOC_STARTERS = [
  "总结这份文档的核心结论与关键结构要点，标注页码",
  "列出文档中最重要的数字指标、时间节点或待办事项",
  "文档中是否有需要重点注意的风险、限制条件或前提假设？",
];

export function ChatArea() {
  const {
    mode,
    books,
    docs,
    selectedBookId,
    selectedDocId,
    selectedProviderId,
    setRightPanelTab,
    setRightPanelOpen,
    setActiveView,
    uploadBook,
    uploadDoc,
    refreshDocs,
    uploading,
  } = useAppStore();

  const {
    sessions,
    activeSessionId,
    chatView,
    loadingSessions,
    focusMessageId,
    summarizingIds,
    messages,
    isStreaming,
    streamingText,
    streamingTools,
    streamingCitations,
    error,
    openOverview,
    clearFocusMessage,
    newSession,
    summarizeSession,
    sendMessage,
    stopStreaming,
    clearError,
  } = useChatStore();

  const { openChapter, openDocPage } = useReaderStore();

  const [draft, setDraft] = useState("");
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrFeedback, setOcrFeedback] = useState<string | null>(null);
  const [collapsedTurns, setCollapsedTurns] = useState<Record<number, boolean>>({});
  const [highlightedMsgId, setHighlightedMsgId] = useState<number | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const emptyUploadRef = useRef<HTMLInputElement>(null);
  const turnRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const initializedSessionKeyRef = useRef<string | null>(null);

  const activeBook = books.find((b) => b.id === selectedBookId) ?? null;
  const activeDoc = docs.find((d) => d.id === selectedDocId) ?? null;
  const targetId = mode === "novel" ? selectedBookId : selectedDocId;
  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;

  const { turns, orphanMessages } = useMemo(
    () => buildQATurns(messages),
    [messages]
  );

  useEffect(() => {
    setOcrFeedback(null);
    setOcrBusy(false);
  }, [selectedDocId]);

  // Reset turn folding defaults when entering a session or focusing a specific historical Q&A
  useEffect(() => {
    if (chatView !== "chat") {
      initializedSessionKeyRef.current = null;
      return;
    }

    const sessionKey = `${mode}:${targetId ?? 0}:${activeSessionId ?? "new"}`;

    if (focusMessageId && turns.some((t) => t.userMsg.id === focusMessageId)) {
      const nextCollapsed: Record<number, boolean> = {};
      if (turns.length >= 3) {
        turns.forEach((t, idx) => {
          const isTarget = t.userMsg.id === focusMessageId;
          const isLast = idx === turns.length - 1;
          nextCollapsed[t.userMsg.id] = !isTarget && !isLast;
        });
      }
      setCollapsedTurns(nextCollapsed);
      initializedSessionKeyRef.current = sessionKey;

      const targetIdToScroll = focusMessageId;
      clearFocusMessage();
      setHighlightedMsgId(targetIdToScroll);

      const raf = window.requestAnimationFrame(() => {
        const el = turnRefs.current[targetIdToScroll];
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      const timer = window.setTimeout(() => {
        setHighlightedMsgId((cur) => (cur === targetIdToScroll ? null : cur));
      }, 2200);
      return () => {
        window.cancelAnimationFrame(raf);
        window.clearTimeout(timer);
      };
    }

    if (initializedSessionKeyRef.current !== sessionKey && turns.length > 0 && !isStreaming) {
      initializedSessionKeyRef.current = sessionKey;
      const nextCollapsed: Record<number, boolean> = {};
      if (turns.length >= 3) {
        turns.forEach((t, idx) => {
          if (idx < turns.length - 2) {
            nextCollapsed[t.userMsg.id] = true;
          }
        });
      }
      setCollapsedTurns(nextCollapsed);
    } else if (turns.length === 0) {
      setCollapsedTurns({});
      if (activeSessionId === null) {
        initializedSessionKeyRef.current = sessionKey;
      }
    }
  }, [
    chatView,
    mode,
    targetId,
    activeSessionId,
    turns,
    focusMessageId,
    isStreaming,
    clearFocusMessage,
  ]);

  // Keep latest streaming turn expanded and scrolled into view
  useEffect(() => {
    if (!isStreaming) return;
    const lastTurn = turns[turns.length - 1];
    if (lastTurn) {
      setCollapsedTurns((prev) =>
        prev[lastTurn.userMsg.id] ? { ...prev, [lastTurn.userMsg.id]: false } : prev
      );
    }
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [isStreaming, turns, streamingText, streamingTools.length]);

  useEffect(() => {
    if (chatView === "chat" && !focusMessageId && !highlightedMsgId && !isStreaming) {
      const el = scrollRef.current;
      if (el) {
        el.scrollTop = el.scrollHeight;
      }
    }
  }, [chatView, messages.length, focusMessageId, highlightedMsgId, isStreaming]);

  function handleCitationClick(kind: "ch" | "p", num: number) {
    if (kind === "ch" && selectedBookId) {
      setRightPanelTab("reader");
      void openChapter(selectedBookId, num);
    } else if (kind === "p" && selectedDocId) {
      setRightPanelOpen(true);
      void openDocPage(selectedDocId, num);
    }
  }

  function renderCitationsBar(citations: Citation[]) {
    if (citations.length === 0) return null;
    return (
      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line pt-2.5">
        {citations.map((c, i) =>
          c.type === "chapter" ? (
            <button
              key={`ch-${c.chapter_num}-${i}`}
              type="button"
              onClick={() => handleCitationClick("ch", c.chapter_num)}
              className="sl-btn inline-flex items-center gap-1 rounded-lg border border-line bg-elevated px-2 py-1 text-[11px] font-medium text-ink-secondary hover:border-accent hover:text-accent"
            >
              <BookOpen className="h-3 w-3 shrink-0 text-accent" />
              <span className="sl-num">第{c.chapter_num}章</span>
              <span className="max-w-[140px] truncate">{c.title}</span>
            </button>
          ) : (
            <button
              key={`p-${c.page_num}-${i}`}
              type="button"
              onClick={() => handleCitationClick("p", c.page_num)}
              className="sl-btn inline-flex items-center gap-1 rounded-lg border border-line bg-elevated px-2 py-1 text-[11px] font-medium text-ink-secondary hover:border-accent hover:text-accent"
            >
              <FileText className="h-3 w-3 shrink-0 text-accent" />
              <span className="sl-num">P{c.page_num}</span>
              <span className="max-w-[140px] truncate">{c.heading}</span>
            </button>
          )
        )}
      </div>
    );
  }

  function renderMarkdown(raw: string) {
    return (
      <div className="sl-prose">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ href, children }) => {
              if (href?.startsWith("#sl-ch-")) {
                const ch = Number(href.replace("#sl-ch-", ""));
                return (
                  <button
                    type="button"
                    onClick={() => handleCitationClick("ch", ch)}
                    className="sl-num mx-0.5 inline-flex items-center rounded-md bg-accent-soft px-1.5 py-0.5 text-[12px] font-medium text-accent hover:underline"
                  >
                    {children}
                  </button>
                );
              }
              if (href?.startsWith("#sl-p-")) {
                const pg = Number(href.replace("#sl-p-", ""));
                return (
                  <button
                    type="button"
                    onClick={() => handleCitationClick("p", pg)}
                    className="sl-num mx-0.5 inline-flex items-center rounded-md bg-accent-soft px-1.5 py-0.5 text-[12px] font-medium text-accent hover:underline"
                  >
                    {children}
                  </button>
                );
              }
              return (
                <a href={href} target="_blank" rel="noreferrer" className="text-accent underline">
                  {children}
                </a>
              );
            },
          }}
        >
          {injectCitationLinks(raw)}
        </ReactMarkdown>
      </div>
    );
  }

  async function handleSend() {
    if (!targetId || !draft.trim() || isStreaming) return;
    const text = draft;
    setDraft("");
    await sendMessage({
      mode,
      targetId,
      message: text,
      providerId: selectedProviderId,
      maxChapter: mode === "novel" ? activeBook?.read_progress_ch : null,
    });
  }

  if (!targetId) {
    const badges = mode === "novel" ? NOVEL_FORMAT_BADGES : DOC_FORMAT_BADGES;
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-10 text-center">
        <input
          ref={emptyUploadRef}
          type="file"
          multiple
          accept={mode === "novel" ? NOVEL_ACCEPT : DOC_ACCEPT}
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            void (async () => {
              for (const file of files) {
                try {
                  if (mode === "novel") {
                    await uploadBook(file);
                  } else {
                    await uploadDoc(file);
                  }
                } catch {
                  // store actionError shows failure detail
                }
              }
            })();
          }}
        />
        <BrandLogo size="lg" />
        <h1 className="mt-4 text-lg font-semibold text-ink">
          {mode === "novel" ? "导入小说，开始防剧透深度查证" : "上传日常文档，随时精准溯源"}
        </h1>
        <p className="mt-1.5 max-w-md text-xs leading-relaxed text-ink-secondary">
          {mode === "novel" ? (
            <>
              点击下方按钮
              <span className="hidden md:inline">，或直接将本地小说文件拖拽到窗口任意位置</span>
              导入。系统会自动还原原书分卷并零成本建立本地全文索引。
            </>
          ) : (
            <>
              点击下方按钮
              <span className="hidden md:inline">，或直接将本地文档拖拽到窗口中</span>
              上传。四万字内全文无损直读，超长文档自动切换分页检索。
            </>
          )}
        </p>

        <div className="mt-4 flex max-w-md flex-wrap justify-center gap-1.5">
          {badges.map((fmt) => (
            <span
              key={fmt}
              className="rounded-md border border-line bg-surface px-2 py-0.5 font-mono text-[10px] font-medium text-ink-secondary"
            >
              {fmt}
            </span>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
          <button
            type="button"
            disabled={uploading}
            onClick={() => emptyUploadRef.current?.click()}
            className="sl-btn inline-flex h-10 items-center gap-1.5 rounded-xl bg-accent px-4 text-xs font-medium text-accent-fg disabled:opacity-50"
          >
            <Upload className="h-3.5 w-3.5" />
            <span>
              {uploading ? (
                "解析入库中..."
              ) : mode === "novel" ? (
                <>
                  <span className="md:hidden">选择小说导入</span>
                  <span className="hidden md:inline">选择或拖拽导入小说</span>
                </>
              ) : (
                <>
                  <span className="md:hidden">选择文档上传</span>
                  <span className="hidden md:inline">选择或拖拽上传文档</span>
                </>
              )}
            </span>
          </button>

          {!selectedProviderId && (
            <button
              type="button"
              onClick={() => setActiveView("settings")}
              className="sl-btn rounded-xl border border-line bg-surface px-4 py-2 text-xs font-medium text-ink hover:border-line-strong"
            >
              前往配置大模型 API Key
            </button>
          )}
        </div>
      </div>
    );
  }

  if (chatView === "overview" && !isStreaming) {
    if (loadingSessions && sessions.length === 0) {
      return (
        <div className="flex flex-1 items-center justify-center gap-2 text-xs text-ink-muted">
          <Loader2 className="h-4 w-4 animate-spin text-accent" />
          <span>正在加载历史对话...</span>
        </div>
      );
    }
    if (sessions.length > 0) {
      return <SessionHistoryOverview />;
    }
  }

  const starters = mode === "novel" ? NOVEL_STARTERS : DOC_STARTERS;
  const allTurnsCollapsed =
    turns.length >= 2 && turns.every((t) => Boolean(collapsedTurns[t.userMsg.id]));
  const isSummarizingActive = Boolean(
    activeSessionId && summarizingIds[activeSessionId]
  );

  function toggleAllTurns() {
    const nextState = !allTurnsCollapsed;
    const next: Record<number, boolean> = {};
    for (const t of turns) {
      next[t.userMsg.id] = nextState;
    }
    setCollapsedTurns(next);
  }

  return (
    <section className="flex flex-1 flex-col min-w-0 min-h-0 bg-canvas">
      {/* Chat Context & Folding Bar */}
      {(sessions.length > 0 || messages.length > 0) && (
        <div className="flex items-center justify-between gap-2 border-b border-line bg-surface/85 px-3 sm:px-6 py-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {sessions.length > 0 && (
              <button
                type="button"
                onClick={openOverview}
                className="sl-btn inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-line bg-elevated px-2.5 text-xs font-medium text-ink-secondary hover:border-accent hover:text-accent"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                <span>历史对话 ({sessions.length})</span>
              </button>
            )}
            <div className="flex items-center gap-1.5 min-w-0">
              {activeSession?.summary_source === "ai" && (
                <Sparkles className="h-3.5 w-3.5 shrink-0 text-accent" />
              )}
              <span className="truncate text-xs font-medium text-ink">
                {activeSession
                  ? activeSession.summary || activeSession.title
                  : "新对话"}
              </span>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            {turns.length >= 2 && (
              <button
                type="button"
                onClick={toggleAllTurns}
                className="sl-btn inline-flex h-8 items-center gap-1 rounded-lg border border-line bg-elevated px-2.5 text-[11px] font-medium text-ink-secondary hover:border-line-strong hover:text-ink"
              >
                {allTurnsCollapsed ? (
                  <>
                    <ChevronsUpDown className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">全部展开</span>
                  </>
                ) : (
                  <>
                    <ChevronsDownUp className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">全部折叠</span>
                  </>
                )}
              </button>
            )}

            {activeSessionId && turns.length >= 1 && selectedProviderId && (
              <button
                type="button"
                disabled={isSummarizingActive || isStreaming}
                onClick={() =>
                  void summarizeSession(activeSessionId, selectedProviderId)
                }
                className="sl-btn inline-flex h-8 items-center gap-1 rounded-lg border border-line bg-elevated px-2.5 text-[11px] font-medium text-ink-secondary hover:border-accent hover:text-accent disabled:opacity-50"
                title="AI 生成或刷新当前会话一句话总结"
              >
                {isSummarizingActive ? (
                  <Loader2 className="h-3 w-3 animate-spin text-accent" />
                ) : (
                  <Sparkles className="h-3 w-3 text-accent" />
                )}
                <span className="hidden sm:inline">
                  {isSummarizingActive ? "总结中..." : "AI 总结"}
                </span>
              </button>
            )}

            {messages.length > 0 && (
              <button
                type="button"
                onClick={newSession}
                className="sl-btn inline-flex h-8 items-center gap-1 rounded-lg bg-accent-soft px-2.5 text-[11px] font-medium text-accent hover:bg-accent hover:text-accent-fg"
              >
                <MessageSquarePlus className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">新对话</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Document Scanned Pages Banner */}
      {mode === "document" && activeDoc?.has_scanned_pages && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-warning/30 bg-warning/10 px-4 py-2 text-xs text-warning shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span className="truncate">
              {ocrFeedback
                ? ocrFeedback
                : `检测到 ${activeDoc.scanned_page_count} 页疑似扫描图/纯图页，可调用多模态视觉模型一键 OCR 识图。`}
            </span>
          </div>
          <button
            type="button"
            disabled={ocrBusy}
            onClick={() => {
              if (!activeDoc) return;
              setOcrBusy(true);
              setOcrFeedback(null);
              void (async () => {
                try {
                  const res = await documentsApi.startOcr(activeDoc.id, selectedProviderId);
                  setOcrFeedback(`已启动视觉 OCR（共 ${res.total_pages} 页），可在右侧面板查看实时进度...`);
                  setRightPanelOpen(true);
                  for (let i = 0; i < 120; i++) {
                    await new Promise((r) => setTimeout(r, 2000));
                    const st = await documentsApi.ocrStatus(activeDoc.id);
                    if (!st.running) {
                      await refreshDocs();
                      setOcrFeedback(
                        st.last_error
                          ? `OCR 结束（完成 ${st.completed_pages}/${st.total_pages} 页）：${st.last_error}`
                          : `视觉 OCR 已完成（识别 ${st.completed_pages} 页）`
                      );
                      break;
                    }
                    setOcrFeedback(
                      `视觉 OCR 识图中（${st.completed_pages}/${st.total_pages} 页）...`
                    );
                  }
                } catch (err) {
                  setOcrFeedback(err instanceof Error ? err.message : "启动视觉 OCR 失败");
                } finally {
                  setOcrBusy(false);
                }
              })();
            }}
            className="sl-btn inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-warning/40 bg-surface/80 px-2.5 text-[11px] font-medium text-ink hover:border-accent disabled:opacity-50"
          >
            {ocrBusy ? (
              <Loader2 className="h-3 w-3 animate-spin text-accent" />
            ) : (
              <ScanEye className="h-3 w-3 text-accent" />
            )}
            <span>{ocrBusy ? "识图中..." : "一键视觉 OCR"}</span>
          </button>
        </div>
      )}

      {/* Messages Stage */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 sm:px-6 py-5 space-y-4">
        {messages.length === 0 && !isStreaming && (
          <div className="mx-auto max-w-[780px] pt-6 pb-4">
            <div className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
              <div className="flex items-center gap-2.5">
                <Sparkles className="h-4 w-4 text-accent" />
                <h2 className="text-sm font-semibold text-ink">
                  {mode === "novel"
                    ? `已载入《${activeBook?.title ?? ""}》`
                    : `已载入《${activeDoc?.filename ?? ""}》`}
                </h2>
              </div>
              <p className="mt-1.5 text-xs text-ink-secondary leading-relaxed">
                {mode === "novel"
                  ? `当前防剧透进度锁位于第 ${activeBook?.read_progress_ch ?? 0} 章。点击下方示例或输入 / 使用指令模板：`
                  : "所有回答都会附带 [p:页码] 引用，点击即可在右侧直接展开对应页正文："}
              </p>
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2">
                {starters.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setDraft(s)}
                    className="sl-btn rounded-xl border border-line bg-elevated/70 p-3 text-left text-xs leading-relaxed text-ink-secondary hover:border-accent hover:text-ink"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {turns.map((turn, idx) => {
          const isLastTurn = idx === turns.length - 1;
          const isTurnStreaming = isStreaming && isLastTurn && !turn.assistantMsg;
          const isCollapsed =
            !isTurnStreaming && Boolean(collapsedTurns[turn.userMsg.id]);
          const isHighlighted = highlightedMsgId === turn.userMsg.id;
          const showFoldHeader = turns.length >= 2 || isCollapsed;
          const citCount = turn.assistantMsg?.citations.length ?? 0;

          return (
            <div
              key={turn.userMsg.id}
              ref={(el) => {
                turnRefs.current[turn.userMsg.id] = el;
              }}
              data-msg-id={turn.userMsg.id}
              className={`mx-auto max-w-[780px] scroll-mt-4 rounded-2xl transition ${
                isHighlighted
                  ? "ring-2 ring-accent/60 bg-accent-soft/20 p-2 sm:p-2.5"
                  : ""
              }`}
            >
              {showFoldHeader && (
                <button
                  type="button"
                  onClick={() =>
                    setCollapsedTurns((prev) => ({
                      ...prev,
                      [turn.userMsg.id]: !isCollapsed,
                    }))
                  }
                  className={`flex w-full items-center justify-between gap-2.5 rounded-xl border px-3 py-2 text-left transition ${
                    isCollapsed
                      ? "border-line bg-surface hover:border-line-strong"
                      : "mb-2.5 border-line/70 bg-elevated/55 hover:border-line"
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="sl-num shrink-0 rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                      Q{turn.index}
                    </span>
                    <span className="truncate text-xs font-medium text-ink">
                      {summarizePreviewText(turn.userMsg.content, 80)}
                    </span>
                    {isCollapsed && turn.assistantMsg && (
                      <span className="hidden md:inline truncate text-[11px] text-ink-muted">
                        — {summarizePreviewText(turn.assistantMsg.content, 50)}
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-ink-muted">
                    {citCount > 0 && (
                      <span className="sl-num rounded bg-elevated px-1.5 py-0.5 text-[10px]">
                        {citCount} 引用
                      </span>
                    )}
                    {isCollapsed ? (
                      <ChevronRight className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5 text-accent" />
                    )}
                  </div>
                </button>
              )}

              {!isCollapsed && (
                <div className="flex flex-col space-y-3">
                  <div className="flex justify-end">
                    <div className="max-w-[88%] sm:max-w-[78%] rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-[14px] leading-relaxed text-accent-fg whitespace-pre-wrap">
                      {turn.userMsg.content}
                    </div>
                  </div>

                  {turn.assistantMsg ? (
                    <div className="w-full rounded-2xl border border-line bg-surface p-4 sm:p-5">
                      <ToolTraceCapsule trace={turn.assistantMsg.tool_trace} />
                      {renderMarkdown(turn.assistantMsg.content)}
                      {renderCitationsBar(turn.assistantMsg.citations)}
                    </div>
                  ) : isTurnStreaming ? (
                    <div className="w-full rounded-2xl border border-line bg-surface p-4 sm:p-5">
                      <ToolTraceCapsule trace={streamingTools} />
                      {streamingText ? (
                        renderMarkdown(streamingText)
                      ) : (
                        <div className="flex items-center gap-2 text-xs text-ink-muted">
                          <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
                          <span>正在查证原文并组织回答...</span>
                        </div>
                      )}
                      {renderCitationsBar(streamingCitations)}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          );
        })}

        {orphanMessages.map((msg) => (
          <div
            key={msg.id}
            className="mx-auto flex max-w-[780px] flex-col items-start"
          >
            <div className="w-full rounded-2xl border border-line bg-surface p-4 sm:p-5">
              <ToolTraceCapsule trace={msg.tool_trace} />
              {renderMarkdown(msg.content)}
              {renderCitationsBar(msg.citations)}
            </div>
          </div>
        ))}
      </div>

      {error && (
        <div className="mx-auto mb-2 flex w-[calc(100%-1.5rem)] max-w-[780px] items-center justify-between rounded-xl border border-danger/30 bg-danger/10 px-3.5 py-2 text-xs text-danger shrink-0">
          <span className="truncate">{error}</span>
          <button type="button" onClick={clearError} className="ml-3 shrink-0 underline">
            关闭
          </button>
        </div>
      )}

      {/* Floating React Bits-inspired PromptBar */}
      <div className="px-3 sm:px-6 pt-1 pb-[max(1rem,calc(0.75rem+env(safe-area-inset-bottom)))] shrink-0 bg-canvas">
        <PromptBar
          activeBook={activeBook}
          activeDoc={activeDoc}
          draft={draft}
          setDraft={setDraft}
          isStreaming={isStreaming}
          onSend={() => void handleSend()}
          onStop={stopStreaming}
          onOpenSettings={() => setActiveView("settings")}
        />
      </div>
    </section>
  );
}
