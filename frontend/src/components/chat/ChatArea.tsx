import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileText,
  Loader2,
  ScanEye,
  Sparkles,
  Upload,
  Wrench,
} from "lucide-react";
import { documentsApi } from "../../api/documents";
import { useAppStore } from "../../stores/appStore";
import { useChatStore } from "../../stores/chatStore";
import { useReaderStore } from "../../stores/readerStore";
import type { Citation, ToolTraceItem } from "../../types/api";
import { BrandLogo } from "../common/BrandLogo";
import {
  DOC_ACCEPT,
  DOC_FORMAT_BADGES,
  NOVEL_ACCEPT,
  NOVEL_FORMAT_BADGES,
} from "../common/fileFormats";
import { PromptBar } from "./PromptBar";

function injectCitationLinks(markdown: string): string {
  return markdown
    .replace(/\[ch:(\d+)\]/g, "[第$1章](#sl-ch-$1)")
    .replace(/\[p:(\d+)\]/g, "[P$1](#sl-p-$1)");
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
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrFeedback, setOcrFeedback] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const emptyUploadRef = useRef<HTMLInputElement>(null);

  const activeBook = books.find((b) => b.id === selectedBookId) ?? null;
  const activeDoc = docs.find((d) => d.id === selectedDocId) ?? null;
  const targetId = mode === "novel" ? selectedBookId : selectedDocId;

  useEffect(() => {
    setOcrFeedback(null);
    setOcrBusy(false);
  }, [selectedDocId]);

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

  const starters = mode === "novel" ? NOVEL_STARTERS : DOC_STARTERS;

  return (
    <section className="flex flex-1 flex-col min-w-0 min-h-0 bg-canvas">
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
                  // Poll until finished so the banner clears automatically once OCR succeeds
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
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 sm:px-6 py-5 space-y-5">
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

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`mx-auto flex max-w-[780px] flex-col ${
              msg.role === "user" ? "items-end" : "items-start"
            }`}
          >
            {msg.role === "user" ? (
              <div className="max-w-[88%] sm:max-w-[78%] rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-[14px] leading-relaxed text-accent-fg whitespace-pre-wrap">
                {msg.content}
              </div>
            ) : (
              <div className="w-full rounded-2xl border border-line bg-surface p-4 sm:p-5">
                <ToolTraceCapsule trace={msg.tool_trace} />
                {renderMarkdown(msg.content)}
                {renderCitationsBar(msg.citations)}
              </div>
            )}
          </div>
        ))}

        {isStreaming && (
          <div className="mx-auto flex max-w-[780px] flex-col items-start">
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
          </div>
        )}
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
