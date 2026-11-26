import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Send,
  Square,
  Wrench,
} from "lucide-react";
import { useAppStore } from "../../stores/appStore";
import { useChatStore } from "../../stores/chatStore";
import { useReaderStore } from "../../stores/readerStore";
import type { Citation, ToolTraceItem } from "../../types/api";

function injectCitationLinks(markdown: string): string {
  return markdown
    .replace(/\[ch:(\d+)\]/g, "[第$1章](#sl-ch-$1)")
    .replace(/\[p:(\d+)\]/g, "[P$1](#sl-p-$1)");
}

function ToolTraceCapsule({ trace }: { trace: ToolTraceItem[] }) {
  const [open, setOpen] = useState(false);
  if (trace.length === 0) return null;
  const running = trace.some((t) => t.status === "running");

  return (
    <div className="mb-2 rounded-lg border border-line bg-elevated/80 text-xs">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-3 py-1.5 text-ink-secondary hover:text-ink"
      >
        <span className="flex items-center gap-1.5">
          {running ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />
          ) : (
            <Wrench className="h-3.5 w-3.5 text-accent" />
          )}
          <span>
            {running
              ? `正在检索资料（第 ${trace[trace.length - 1]?.round ?? 1} 轮）...`
              : `已执行 ${trace.length} 次检索步骤`}
          </span>
        </span>
        {open ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
      </button>
      {open && (
        <div className="border-t border-line px-3 py-2 space-y-1 font-mono text-[11px] text-ink-secondary">
          {trace.map((item, idx) => (
            <div key={idx} className="flex items-center justify-between gap-2">
              <span className="truncate">
                {item.tool ?? item.mode ?? "step"}{" "}
                {item.arguments ? JSON.stringify(item.arguments) : ""}
              </span>
              <span className="shrink-0 flex items-center gap-1 text-ink-muted">
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
  } = useAppStore();

  const {
    messages,
    isStreaming,
    streamingText,
    streamingTools,
    streamingCitations,
    error,
    sendMessage,
    stopStreaming,
    clearError,
  } = useChatStore();

  const { openChapter, openDocPage } = useReaderStore();

  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const activeBook = books.find((b) => b.id === selectedBookId) ?? null;
  const activeDoc = docs.find((d) => d.id === selectedDocId) ?? null;
  const targetId = mode === "novel" ? selectedBookId : selectedDocId;

  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length, streamingText, streamingTools.length]);

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
      <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-line pt-2">
        {citations.map((c, i) =>
          c.type === "chapter" ? (
            <button
              key={`ch-${c.chapter_num}-${i}`}
              type="button"
              onClick={() => handleCitationClick("ch", c.chapter_num)}
              className="inline-flex items-center gap-1 rounded-md border border-line bg-elevated px-2 py-0.5 text-[11px] text-ink-secondary hover:border-accent hover:text-accent"
            >
              <BookOpen className="h-3 w-3" />
              <span>
                第{c.chapter_num}章 {c.title}
              </span>
            </button>
          ) : (
            <button
              key={`p-${c.page_num}-${i}`}
              type="button"
              onClick={() => handleCitationClick("p", c.page_num)}
              className="inline-flex items-center gap-1 rounded-md border border-line bg-elevated px-2 py-0.5 text-[11px] text-ink-secondary hover:border-accent hover:text-accent"
            >
              <span>
                P{c.page_num} · {c.heading}
              </span>
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
                    className="mx-0.5 inline-flex items-center rounded bg-accent-soft px-1.5 py-0.2 text-xs font-medium text-accent hover:underline"
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
                    className="mx-0.5 inline-flex items-center rounded bg-accent-soft px-1.5 py-0.2 text-xs font-medium text-accent hover:underline"
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

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  if (!targetId) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
        <h2 className="text-base font-semibold text-ink">
          {mode === "novel" ? "请先导入或选择一部小说" : "请先上传或选择一份文档"}
        </h2>
        <p className="mt-1.5 max-w-md text-xs text-ink-secondary">
          {mode === "novel"
            ? "支持千万字级 TXT / EPUB 原书分卷解析、防剧透进度锁、别名扩展与章节溯源。"
            : "支持纯文字 PDF / PPTX / DOCX / MD / TXT，小文档全文直读，大文档自动切换分页检索。"}
        </p>
        {!selectedProviderId && (
          <button
            type="button"
            onClick={() => setActiveView("settings")}
            className="mt-4 rounded-lg bg-accent px-4 py-2 text-xs font-medium text-accent-fg"
          >
            前往配置大模型 API Key
          </button>
        )}
      </div>
    );
  }

  return (
    <section className="flex flex-1 flex-col min-w-0 bg-canvas">
      {/* Header strip */}
      <div className="flex items-center justify-between border-b border-line bg-surface/70 px-4 py-2 text-xs">
        <div className="truncate font-medium text-ink">
          {mode === "novel"
            ? `${activeBook?.title ?? ""} · 防剧透锁定至第 ${activeBook?.read_progress_ch ?? 0} 章`
            : `${activeDoc?.filename ?? ""} · ${activeDoc?.total_pages ?? 0} 页`}
        </div>
      </div>

      {/* Document scanned pages warning */}
      {mode === "document" && activeDoc?.has_scanned_pages && (
        <div className="flex items-center gap-2 border-b border-warning/30 bg-warning/10 px-4 py-2 text-xs text-warning">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            检测到 {activeDoc.scanned_page_count} 页疑似扫描图/纯图页，当前版本仅解析纯文字（视觉识图将在后续版本开放）。
          </span>
        </div>
      )}

      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-5 space-y-4">
        {messages.length === 0 && !isStreaming && (
          <div className="mx-auto max-w-xl rounded-xl border border-dashed border-line-strong bg-surface/60 p-5 text-center text-xs text-ink-secondary">
            输入问题开始提问，回答中的 <code className="rounded bg-hover px-1">[ch:N]</code> 或{" "}
            <code className="rounded bg-hover px-1">[p:N]</code> 引用可直接点击溯源阅读。
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`mx-auto flex max-w-3xl flex-col ${
              msg.role === "user" ? "items-end" : "items-start"
            }`}
          >
            {msg.role === "user" ? (
              <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-accent px-4 py-2.5 text-sm text-accent-fg whitespace-pre-wrap">
                {msg.content}
              </div>
            ) : (
              <div className="w-full rounded-2xl border border-line bg-surface p-4 shadow-sm">
                <ToolTraceCapsule trace={msg.tool_trace} />
                {renderMarkdown(msg.content)}
                {renderCitationsBar(msg.citations)}
              </div>
            )}
          </div>
        ))}

        {isStreaming && (
          <div className="mx-auto flex max-w-3xl flex-col items-start">
            <div className="w-full rounded-2xl border border-line bg-surface p-4 shadow-sm">
              <ToolTraceCapsule trace={streamingTools} />
              {streamingText ? (
                renderMarkdown(streamingText)
              ) : (
                <div className="flex items-center gap-2 text-xs text-ink-muted">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>正在思考与检索...</span>
                </div>
              )}
              {renderCitationsBar(streamingCitations)}
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="mx-4 mb-2 flex items-center justify-between rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          <span>{error}</span>
          <button type="button" onClick={clearError} className="underline">
            关闭
          </button>
        </div>
      )}

      {/* Composer */}
      <div className="border-t border-line bg-surface p-3">
        <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-xl border border-line bg-elevated p-2 focus-within:border-accent">
          <textarea
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              mode === "novel"
                ? "询问剧情脉络、人物关系、势力演变（Enter 发送，Shift+Enter 换行）"
                : "针对当前文档内容提问（Enter 发送，Shift+Enter 换行）"
            }
            className="flex-1 resize-none bg-transparent px-2 py-1 text-sm text-ink outline-none placeholder:text-ink-muted"
          />
          {isStreaming ? (
            <button
              type="button"
              onClick={stopStreaming}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-danger text-white"
              title="停止生成"
            >
              <Square className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              disabled={!draft.trim()}
              onClick={() => void handleSend()}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-fg disabled:opacity-40"
              title="发送"
            >
              <Send className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
