import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  ArrowUp,
  BookOpen,
  Cpu,
  FileText,
  Lock,
  Paperclip,
  Slash,
  Square,
} from "lucide-react";
import { useAppStore } from "../../stores/appStore";
import type { Book, DocumentItem, NovelScenario } from "../../types/api";
import {
  DOC_ACCEPT,
  DOC_FORMAT_SUMMARY,
  NOVEL_ACCEPT,
  NOVEL_FORMAT_SUMMARY,
} from "../common/fileFormats";

interface SlashTemplate {
  command: string;
  label: string;
  prompt: string;
}

const NOVEL_COMMANDS: SlashTemplate[] = [
  {
    command: "/脉络",
    label: "梳理当前进度主线剧情与关键转折",
    prompt: "请结合当前已读进度，梳理至今为止的主线剧情脉络与核心转折点，并附上章节引用。",
  },
  {
    command: "/出场",
    label: "查询某角色/势力的首次与关键出场节点",
    prompt: "请检索「」的首次出场章节、全书分布跨度以及关键行为演变，附上章节引用。",
  },
  {
    command: "/设定",
    label: "核对体系、境界或势力设定细节",
    prompt: "请核对文中关于「」的完整设定描述与前后变化，不要剧透未读章节。",
  },
  {
    command: "/关系",
    label: "分析两个角色或势力之间的交集与恩怨",
    prompt: "请检索「」与「」产生交集的章节，梳理双方关系变化过程。",
  },
];

const DOC_COMMANDS: SlashTemplate[] = [
  {
    command: "/摘要",
    label: "提炼核心结论与章节结构要点",
    prompt: "请分条提炼这份文档的核心结论、关键数据与结构要点，并标注 [p:页码] 出处。",
  },
  {
    command: "/条款",
    label: "定位特定条件、指标或限制条款",
    prompt: "请检索文档中关于「」的具体条款、数值指标或限制条件，附上页码引用。",
  },
  {
    command: "/待办",
    label: "提取行动项、风险点与时间节点",
    prompt: "请从文档中提取所有明确的行动项、时间节点与潜在风险，标注对应页码。",
  },
  {
    command: "/对比",
    label: "对比文档中不同方案或阶段差异",
    prompt: "请整理并对比文档中提到的不同方案或阶段的优缺点与关键差异。",
  },
];

interface PromptBarProps {
  activeBook: Book | null;
  activeDoc: DocumentItem | null;
  draft: string;
  setDraft: (val: string) => void;
  isStreaming: boolean;
  onSend: () => void;
  onStop: () => void;
  onOpenSettings: () => void;
}

const NOVEL_SCENARIOS: Array<{
  id: NovelScenario;
  label: string;
  hint: string;
}> = [
  { id: "verify", label: "严谨考据", hint: "逐条带 [ch:N] 出处，无证据明说" },
  { id: "recap", label: "前情回顾", hint: "停更重拾：主线、人物现状与悬念" },
  { id: "discuss", label: "防剧透推演", hint: "区分已读事实与合理推测，绝不剧透" },
];

export function PromptBar({
  activeBook,
  activeDoc,
  draft,
  setDraft,
  isStreaming,
  onSend,
  onStop,
  onOpenSettings,
}: PromptBarProps) {
  const {
    mode,
    novelScenario,
    setNovelScenario,
    providers,
    selectedProviderId,
    selectProvider,
    updateReadProgress,
    uploadBook,
    uploadDoc,
    uploading,
  } = useAppStore();

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const spoilerPopoverRef = useRef<HTMLDivElement>(null);

  const [slashOpen, setSlashOpen] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const [spoilerOpen, setSpoilerOpen] = useState(false);
  const [spoilerVal, setSpoilerVal] = useState<number>(1);
  const [focused, setFocused] = useState(false);

  const commands = mode === "novel" ? NOVEL_COMMANDS : DOC_COMMANDS;

  const filteredCommands = useMemo(() => {
    const trimmed = draft.trimStart();
    if (!slashOpen && !trimmed.startsWith("/")) return [];
    const token = trimmed.startsWith("/") ? trimmed.split(/\s+/)[0].toLowerCase() : "";
    if (!token || token === "/") return commands;
    return commands.filter(
      (c) =>
        c.command.toLowerCase().includes(token) ||
        c.label.toLowerCase().includes(token)
    );
  }, [commands, draft, slashOpen]);

  const showSlashMenu =
    (slashOpen || draft.trimStart().startsWith("/")) &&
    filteredCommands.length > 0 &&
    !draft.includes("\n") &&
    draft.length < 28;

  useEffect(() => {
    if (activeBook) {
      setSpoilerVal(activeBook.read_progress_ch);
    }
  }, [activeBook?.id, activeBook?.read_progress_ch]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(160, Math.max(42, ta.scrollHeight))}px`;
  }, [draft]);

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (
        spoilerOpen &&
        spoilerPopoverRef.current &&
        !spoilerPopoverRef.current.contains(e.target as Node)
      ) {
        setSpoilerOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [spoilerOpen]);

  useEffect(() => {
    function handleAndroidBack(e: Event) {
      if (spoilerOpen) {
        e.preventDefault();
        setSpoilerOpen(false);
      } else if (slashOpen) {
        e.preventDefault();
        setSlashOpen(false);
      }
    }
    window.addEventListener("scrolllens:back", handleAndroidBack);
    return () => window.removeEventListener("scrolllens:back", handleAndroidBack);
  }, [spoilerOpen, slashOpen]);

  function applyCommand(item: SlashTemplate) {
    setDraft(item.prompt);
    setSlashOpen(false);
    setSlashIndex(0);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (showSlashMenu) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIndex((i) => (i + 1) % filteredCommands.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIndex((i) => (i - 1 + filteredCommands.length) % filteredCommands.length);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashOpen(false);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const picked = filteredCommands[slashIndex] ?? filteredCommands[0];
        if (picked) applyCommand(picked);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!isStreaming && draft.trim()) {
        onSend();
      }
    }
  }

  async function handleQuickUpload(file: File | undefined) {
    if (!file) return;
    if (mode === "novel") {
      await uploadBook(file);
    } else {
      await uploadDoc(file);
    }
  }

  function commitSpoiler(val: number) {
    if (!activeBook) return;
    const clamped = Math.max(1, Math.min(activeBook.total_chapters, val || 1));
    setSpoilerVal(clamped);
    void updateReadProgress(activeBook.id, clamped);
  }

  return (
    <div className="relative mx-auto w-full max-w-[780px]">
      {/* React Bits-style Slash Command Popover */}
      {showSlashMenu && (
        <div className="sl-animate-pop absolute bottom-full left-0 right-0 z-30 mb-2 overflow-hidden rounded-2xl border border-line-strong bg-surface shadow-lg">
          <div className="flex items-center justify-between border-b border-line px-3.5 py-2 text-[11px] text-ink-muted">
            <span>
              快捷提问模板
              <span className="hidden sm:inline">（↑↓ 选择，Enter 插入，Esc 关闭）</span>
            </span>
            <span>{mode === "novel" ? "网文查证" : "文档分析"}</span>
          </div>
          <div className="max-h-56 overflow-y-auto p-1.5 space-y-0.5">
            {filteredCommands.map((item, idx) => {
              const active = idx === slashIndex;
              return (
                <button
                  key={item.command}
                  type="button"
                  onMouseEnter={() => setSlashIndex(idx)}
                  onClick={() => applyCommand(item)}
                  className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-xs transition ${
                    active ? "bg-accent-soft text-ink" : "text-ink-secondary hover:bg-hover"
                  }`}
                >
                  <span className="font-mono font-semibold text-accent shrink-0">
                    {item.command}
                  </span>
                  <span className="flex-1 truncate text-ink-secondary">{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Main Prompt Bar Container */}
      <div
        className={`relative rounded-2xl border bg-surface transition-colors duration-200 ${
          focused
            ? "border-accent shadow-sm"
            : "border-line-strong hover:border-ink-muted/60"
        }`}
      >
        {/* Top Context Strip: Active Resource + Interactive Spoiler Lock */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
          <div className="flex items-center gap-2 min-w-0">
            {mode === "novel" && activeBook ? (
              <>
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-elevated px-2 py-1 text-[11px] font-medium text-ink max-w-[180px] sm:max-w-[260px]">
                  <BookOpen className="h-3.5 w-3.5 shrink-0 text-accent" />
                  <span className="truncate">{activeBook.title}</span>
                </span>

                <div ref={spoilerPopoverRef} className="sm:relative">
                  <button
                    type="button"
                    onClick={() => setSpoilerOpen(!spoilerOpen)}
                    className="sl-btn inline-flex items-center gap-1.5 rounded-lg border border-line bg-elevated/80 px-2 py-1 text-[11px] font-medium text-ink-secondary hover:border-accent hover:text-ink"
                    title="调整防剧透进度锁"
                  >
                    <Lock className="h-3 w-3 text-accent" />
                    <span className="sl-num">
                      第 {activeBook.read_progress_ch} / {activeBook.total_chapters} 章
                    </span>
                  </button>

                  {spoilerOpen && (
                    <div className="sl-animate-pop absolute bottom-full inset-x-2 sm:inset-x-auto sm:left-0 z-30 mb-2 sm:w-72 rounded-2xl border border-line-strong bg-surface p-3.5 shadow-lg">
                      <div className="flex items-center justify-between text-xs font-semibold text-ink">
                        <span>防剧透进度锁</span>
                        <span className="sl-num text-[11px] font-normal text-ink-muted">
                          共 {activeBook.total_chapters} 章
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] text-ink-secondary">
                        Agent 严禁检索或透露此章号之后的剧情与卷纲。
                      </p>
                      <div className="mt-3 flex items-center gap-2.5">
                        <input
                          type="range"
                          min={1}
                          max={Math.max(1, activeBook.total_chapters)}
                          value={spoilerVal}
                          onChange={(e) => setSpoilerVal(Number(e.target.value))}
                          onMouseUp={() => commitSpoiler(spoilerVal)}
                          onTouchEnd={() => commitSpoiler(spoilerVal)}
                          className="flex-1 accent-accent cursor-pointer"
                        />
                        <input
                          type="number"
                          min={1}
                          max={Math.max(1, activeBook.total_chapters)}
                          value={spoilerVal}
                          onChange={(e) => setSpoilerVal(Number(e.target.value))}
                          onBlur={() => commitSpoiler(spoilerVal)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              commitSpoiler(spoilerVal);
                              setSpoilerOpen(false);
                            }
                          }}
                          className="sl-num w-16 rounded-lg border border-line bg-elevated px-2 py-1 text-right text-xs text-ink outline-none focus:border-accent"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : mode === "document" && activeDoc ? (
              <div className="flex items-center gap-2 min-w-0">
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-elevated px-2 py-1 text-[11px] font-medium text-ink max-w-[200px] sm:max-w-[300px]">
                  <FileText className="h-3.5 w-3.5 shrink-0 text-accent" />
                  <span className="truncate">{activeDoc.filename}</span>
                </span>
                <span className="sl-num rounded-md bg-elevated px-1.5 py-0.5 text-[11px] text-ink-secondary">
                  {activeDoc.total_pages} 页 ·{" "}
                  {activeDoc.retrieval_mode === "direct" ? "全文直读" : "分页检索"}
                </span>
              </div>
            ) : (
              <span className="text-[11px] text-ink-muted">
                {mode === "novel" ? "未选择小说" : "未选择文档"}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {mode === "novel" && activeBook && (
              <div
                className="flex items-center rounded-lg border border-line bg-elevated p-0.5 text-[11px]"
                title="切换网文问答情景模式"
              >
                {NOVEL_SCENARIOS.map((sc) => (
                  <button
                    key={sc.id}
                    type="button"
                    onClick={() => setNovelScenario(sc.id)}
                    title={sc.hint}
                    className={`rounded-md px-2 py-0.5 font-medium transition ${
                      novelScenario === sc.id
                        ? "bg-surface text-ink shadow-sm"
                        : "text-ink-secondary hover:text-ink"
                    }`}
                  >
                    {sc.label}
                  </button>
                ))}
              </div>
            )}
            <span className="hidden lg:inline text-[11px] text-ink-muted">
              输入 <code className="rounded bg-elevated px-1 py-0.5 font-mono">/</code> 唤起指令
            </span>
          </div>
        </div>

        {/* Textarea Input */}
        <div className="px-3.5 pt-2.5 pb-1">
          <textarea
            ref={textareaRef}
            rows={1}
            value={draft}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(e) => {
              setDraft(e.target.value);
              if (!e.target.value.startsWith("/")) {
                setSlashOpen(false);
              }
            }}
            onKeyDown={handleKeyDown}
            placeholder={
              mode === "novel"
                ? "追问剧情、人物伏笔或势力演变，输入 / 查看快捷模板..."
                : "针对当前文档提问、提炼要点或核对条款，输入 / 查看模板..."
            }
            className="w-full resize-none bg-transparent text-[14.5px] leading-6 text-ink outline-none placeholder:text-ink-muted"
          />
        </div>

        {/* Bottom Micro-Interaction Action Strip */}
        <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5 pt-1">
          <div className="flex items-center gap-1 min-w-0">
            <button
              type="button"
              onClick={() => {
                setSlashOpen(!slashOpen);
                setSlashIndex(0);
                textareaRef.current?.focus();
              }}
              className={`sl-btn inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-secondary hover:bg-hover hover:text-ink ${
                showSlashMenu ? "bg-accent-soft text-accent" : ""
              }`}
              title="快捷指令模板 (/)"
              aria-label="快捷指令模板"
            >
              <Slash className="h-4 w-4" />
            </button>

            <input
              ref={uploadInputRef}
              type="file"
              accept={mode === "novel" ? NOVEL_ACCEPT : DOC_ACCEPT}
              className="hidden"
              onChange={(e) => {
                void handleQuickUpload(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              disabled={uploading}
              onClick={() => uploadInputRef.current?.click()}
              className="sl-btn inline-flex h-8 w-8 items-center justify-center rounded-lg text-ink-secondary hover:bg-hover hover:text-ink disabled:opacity-40"
              title={
                mode === "novel"
                  ? `快速导入小说（${NOVEL_FORMAT_SUMMARY}）`
                  : `快速上传文档（${DOC_FORMAT_SUMMARY}）`
              }
              aria-label="上传文件"
            >
              <Paperclip className="h-4 w-4" />
            </button>

            {/* Compact Model Selector inside PromptBar */}
            <div className="inline-flex flex-1 sm:flex-initial items-center gap-1 rounded-lg border border-line bg-elevated/80 px-2 h-9 sm:h-8 min-w-0 max-w-[230px] sm:max-w-[250px]">
              <Cpu className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
              {providers.length === 0 ? (
                <button
                  type="button"
                  onClick={onOpenSettings}
                  className="truncate text-[11px] font-medium text-accent hover:underline"
                >
                  配置模型 Key
                </button>
              ) : (
                <select
                  value={selectedProviderId ?? ""}
                  onChange={(e) =>
                    selectProvider(e.target.value ? Number(e.target.value) : null)
                  }
                  aria-label="选择对话模型"
                  className="w-full truncate bg-transparent text-[11px] font-medium text-ink outline-none cursor-pointer"
                >
                  {providers.map((p) => (
                    <option key={p.id} value={p.id} className="bg-surface text-ink">
                      {p.name} · {p.model_name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {draft.length > 0 && (
              <span className="sl-num hidden sm:inline text-[11px] text-ink-muted">
                {draft.length} 字
              </span>
            )}

            {isStreaming ? (
              <button
                type="button"
                onClick={onStop}
                className="sl-btn inline-flex h-9 items-center gap-1.5 rounded-xl bg-danger px-3 text-xs font-medium text-white"
                title="停止生成"
                aria-label="停止生成"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
                <span>停止</span>
              </button>
            ) : (
              <button
                type="button"
                disabled={!draft.trim() || (!activeBook && !activeDoc)}
                onClick={onSend}
                className="sl-btn inline-flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-accent-fg disabled:opacity-35"
                title="发送 (Enter)"
                aria-label="发送消息"
              >
                <ArrowUp className="h-4 w-4 stroke-[2.25]" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
