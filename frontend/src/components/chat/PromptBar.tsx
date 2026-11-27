import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  ArrowLeft,
  ArrowUp,
  BookMarked,
  BookOpen,
  Check,
  Cpu,
  FileText,
  ListTree,
  Lock,
  Paperclip,
  Plus,
  Slash,
  Sparkles,
  Square,
  Users,
  X,
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
    setNovelTab,
    setRightPanelTab,
    providers,
    selectedProviderId,
    selectProvider,
    updateReadProgress,
    uploadBook,
    uploadDoc,
    uploading,
  } = useAppStore();

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mobileTextareaRef = useRef<HTMLTextAreaElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const spoilerPopoverRef = useRef<HTMLDivElement>(null);

  const [slashOpen, setSlashOpen] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const [spoilerOpen, setSpoilerOpen] = useState(false);
  const [spoilerVal, setSpoilerVal] = useState<number>(1);
  const [focused, setFocused] = useState(false);
  const [mobileTrayOpen, setMobileTrayOpen] = useState(false);
  const [mobileTrayPanel, setMobileTrayPanel] = useState<
    "grid" | "spoiler" | "scenario" | "model" | "templates"
  >("grid");

  const activeScenario =
    NOVEL_SCENARIOS.find((s) => s.id === novelScenario) ?? NOVEL_SCENARIOS[0];
  const activeProvider =
    providers.find((p) => p.id === selectedProviderId) ?? null;

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
    if (ta) {
      ta.style.height = "auto";
      ta.style.height = `${Math.min(160, Math.max(42, ta.scrollHeight))}px`;
    }
    const mta = mobileTextareaRef.current;
    if (mta) {
      mta.style.height = "auto";
      mta.style.height = `${Math.min(110, Math.max(24, mta.scrollHeight))}px`;
    }
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
      if (mobileTrayOpen) {
        e.preventDefault();
        if (mobileTrayPanel !== "grid") {
          setMobileTrayPanel("grid");
        } else {
          setMobileTrayOpen(false);
        }
      } else if (spoilerOpen) {
        e.preventDefault();
        setSpoilerOpen(false);
      } else if (slashOpen) {
        e.preventDefault();
        setSlashOpen(false);
      }
    }
    window.addEventListener("scrolllens:back", handleAndroidBack);
    return () => window.removeEventListener("scrolllens:back", handleAndroidBack);
  }, [mobileTrayOpen, mobileTrayPanel, spoilerOpen, slashOpen]);

  function closeMobileTray() {
    setMobileTrayOpen(false);
    setMobileTrayPanel("grid");
  }

  function applyCommand(item: SlashTemplate) {
    setDraft(item.prompt);
    setSlashOpen(false);
    setSlashIndex(0);
    closeMobileTray();
    requestAnimationFrame(() => {
      if (window.innerWidth < 768) {
        mobileTextareaRef.current?.focus();
      } else {
        textareaRef.current?.focus();
      }
    });
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
    <>
      {/* Shared hidden file input for quick upload */}
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

      {/* ===== Mobile WeChat / Telegram-style Composer (< md) ===== */}
      <div className="md:hidden border-t border-line bg-surface">
        {/* Subtle indicator ONLY when user switched away from default mode */}
        {mode === "novel" && novelScenario !== "verify" && (
          <div className="flex items-center justify-between border-b border-line/70 bg-elevated/60 px-3 py-1 text-[11px] text-ink-secondary">
            <span className="inline-flex items-center gap-1 font-medium text-accent">
              <Sparkles className="h-3 w-3" />
              <span>当前模式：{activeScenario.label}</span>
            </span>
            <button
              type="button"
              onClick={() => setNovelScenario("verify")}
              className="text-ink-muted hover:text-ink"
            >
              切回严谨考据
            </button>
          </div>
        )}

        {/* Single-row Composer Bar */}
        <div
          className={`flex items-end gap-2 px-2.5 pt-2 ${
            mobileTrayOpen
              ? "pb-2"
              : "pb-[max(0.5rem,env(safe-area-inset-bottom))]"
          }`}
        >
          <button
            type="button"
            onClick={() => {
              if (mobileTrayOpen) {
                closeMobileTray();
              } else {
                mobileTextareaRef.current?.blur();
                setMobileTrayPanel("grid");
                setMobileTrayOpen(true);
              }
            }}
            className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border ${
              mobileTrayOpen
                ? "border-accent bg-accent-soft text-accent"
                : "border-line bg-elevated text-ink-secondary"
            }`}
            aria-label={mobileTrayOpen ? "收起工具栏" : "展开功能工具栏"}
          >
            {mobileTrayOpen ? (
              <X className="h-4 w-4" />
            ) : (
              <Plus className="h-5 w-5" />
            )}
          </button>

          <div className="flex-1 min-w-0 rounded-2xl border border-line bg-elevated px-3.5 py-1.5 focus-within:border-accent">
            <textarea
              ref={mobileTextareaRef}
              rows={1}
              value={draft}
              onFocus={() => {
                if (mobileTrayOpen) closeMobileTray();
              }}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (!isStreaming && draft.trim()) {
                    closeMobileTray();
                    onSend();
                  }
                }
              }}
              placeholder={
                mode === "novel"
                  ? activeBook
                    ? `追问《${activeBook.title}》...`
                    : "输入问题..."
                  : "针对当前文档提问..."
              }
              className="block w-full resize-none bg-transparent text-[15px] leading-[22px] text-ink outline-none placeholder:text-ink-muted"
            />
          </div>

          {isStreaming ? (
            <button
              type="button"
              onClick={onStop}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-danger text-white"
              aria-label="停止生成"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              disabled={!draft.trim() || (!activeBook && !activeDoc)}
              onClick={() => {
                closeMobileTray();
                onSend();
              }}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg disabled:opacity-35"
              aria-label="发送消息"
            >
              <ArrowUp className="h-4 w-4 stroke-[2.25]" />
            </button>
          )}
        </div>

        {/* WeChat / Telegram Bottom Tool Drawer (instant toggle, no fancy animation) */}
        {mobileTrayOpen && (
          <div className="border-t border-line bg-canvas px-3 pt-3 pb-[max(0.875rem,env(safe-area-inset-bottom))]">
            {mobileTrayPanel === "grid" && mode === "novel" && (
              <div className="grid grid-cols-4 gap-x-2 gap-y-3.5">
                <button
                  type="button"
                  onClick={() => {
                    closeMobileTray();
                    setNovelTab("cards");
                  }}
                  className="flex flex-col items-center gap-1.5 text-center"
                >
                  <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-surface text-ink">
                    <Users className="h-5 w-5 text-accent" />
                  </span>
                  <span className="text-[11px] font-medium text-ink">人物卡</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    closeMobileTray();
                    setNovelTab("reader");
                  }}
                  className="flex flex-col items-center gap-1.5 text-center"
                >
                  <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-surface text-ink">
                    <BookOpen className="h-5 w-5 text-accent" />
                  </span>
                  <span className="text-[11px] font-medium text-ink">看原文</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    closeMobileTray();
                    setRightPanelTab("volumes");
                  }}
                  className="flex flex-col items-center gap-1.5 text-center"
                >
                  <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-surface text-ink">
                    <ListTree className="h-5 w-5 text-ink-secondary" />
                  </span>
                  <span className="text-[11px] font-medium text-ink">分卷卷纲</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    closeMobileTray();
                    setRightPanelTab("aliases");
                  }}
                  className="flex flex-col items-center gap-1.5 text-center"
                >
                  <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-surface text-ink">
                    <BookMarked className="h-5 w-5 text-ink-secondary" />
                  </span>
                  <span className="text-[11px] font-medium text-ink">别名设定</span>
                </button>

                <button
                  type="button"
                  disabled={!activeBook}
                  onClick={() => setMobileTrayPanel("spoiler")}
                  className="flex flex-col items-center gap-1 text-center disabled:opacity-40"
                >
                  <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-surface text-ink">
                    <Lock className="h-5 w-5 text-accent" />
                  </span>
                  <span className="text-[11px] font-medium text-ink">防剧透锁</span>
                  {activeBook && (
                    <span className="sl-num -mt-0.5 text-[10px] text-ink-muted">
                      第{activeBook.read_progress_ch}章
                    </span>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setMobileTrayPanel("scenario")}
                  className="flex flex-col items-center gap-1 text-center"
                >
                  <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-surface text-ink">
                    <Sparkles className="h-5 w-5 text-accent" />
                  </span>
                  <span className="text-[11px] font-medium text-ink">提问模式</span>
                  <span className="-mt-0.5 text-[10px] text-ink-muted">
                    {activeScenario.label}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setMobileTrayPanel("model")}
                  className="flex flex-col items-center gap-1 text-center"
                >
                  <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-surface text-ink">
                    <Cpu className="h-5 w-5 text-ink-secondary" />
                  </span>
                  <span className="text-[11px] font-medium text-ink">切换模型</span>
                  <span className="-mt-0.5 max-w-[68px] truncate text-[10px] text-ink-muted">
                    {activeProvider ? activeProvider.name : "未配置"}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setMobileTrayPanel("templates")}
                  className="flex flex-col items-center gap-1 text-center"
                >
                  <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-surface text-ink">
                    <Slash className="h-5 w-5 text-ink-secondary" />
                  </span>
                  <span className="text-[11px] font-medium text-ink">快捷模板</span>
                </button>
              </div>
            )}

            {mobileTrayPanel === "grid" && mode === "document" && (
              <div className="grid grid-cols-4 gap-x-2 gap-y-3.5">
                <button
                  type="button"
                  onClick={() => {
                    closeMobileTray();
                    setRightPanelTab("volumes");
                  }}
                  className="flex flex-col items-center gap-1.5 text-center"
                >
                  <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-surface text-ink">
                    <FileText className="h-5 w-5 text-accent" />
                  </span>
                  <span className="text-[11px] font-medium text-ink">文档正文</span>
                </button>

                <button
                  type="button"
                  onClick={() => setMobileTrayPanel("templates")}
                  className="flex flex-col items-center gap-1.5 text-center"
                >
                  <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-surface text-ink">
                    <Slash className="h-5 w-5 text-ink-secondary" />
                  </span>
                  <span className="text-[11px] font-medium text-ink">快捷模板</span>
                </button>

                <button
                  type="button"
                  onClick={() => setMobileTrayPanel("model")}
                  className="flex flex-col items-center gap-1 text-center"
                >
                  <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-surface text-ink">
                    <Cpu className="h-5 w-5 text-ink-secondary" />
                  </span>
                  <span className="text-[11px] font-medium text-ink">切换模型</span>
                  <span className="-mt-0.5 max-w-[68px] truncate text-[10px] text-ink-muted">
                    {activeProvider ? activeProvider.name : "未配置"}
                  </span>
                </button>

                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => {
                    closeMobileTray();
                    uploadInputRef.current?.click();
                  }}
                  className="flex flex-col items-center gap-1.5 text-center disabled:opacity-40"
                >
                  <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-surface text-ink">
                    <Paperclip className="h-5 w-5 text-ink-secondary" />
                  </span>
                  <span className="text-[11px] font-medium text-ink">上传文档</span>
                </button>
              </div>
            )}

            {mobileTrayPanel === "spoiler" && activeBook && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setMobileTrayPanel("grid")}
                    className="inline-flex items-center gap-1 text-xs font-medium text-ink-secondary"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    <span>防剧透进度锁</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => commitSpoiler(activeBook.total_chapters)}
                    className="rounded-lg border border-line bg-surface px-2 py-1 text-[11px] font-medium text-accent"
                  >
                    锁至最新（第 {activeBook.total_chapters} 章）
                  </button>
                </div>
                <p className="text-[11px] text-ink-secondary">
                  严禁检索或透露此章节之后的剧情与卷纲，当前锁定第 {spoilerVal} /{" "}
                  {activeBook.total_chapters} 章。
                </p>
                <div className="flex items-center gap-2.5">
                  <input
                    type="range"
                    min={1}
                    max={Math.max(1, activeBook.total_chapters)}
                    value={spoilerVal}
                    onChange={(e) => setSpoilerVal(Number(e.target.value))}
                    onMouseUp={() => commitSpoiler(spoilerVal)}
                    onTouchEnd={() => commitSpoiler(spoilerVal)}
                    className="flex-1 accent-accent"
                  />
                  <input
                    type="number"
                    min={1}
                    max={Math.max(1, activeBook.total_chapters)}
                    value={spoilerVal}
                    onChange={(e) => setSpoilerVal(Number(e.target.value))}
                    onBlur={() => commitSpoiler(spoilerVal)}
                    className="sl-num w-20 rounded-xl border border-line bg-surface px-2.5 py-1.5 text-right text-xs text-ink outline-none focus:border-accent"
                  />
                </div>
              </div>
            )}

            {mobileTrayPanel === "scenario" && (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setMobileTrayPanel("grid")}
                  className="inline-flex items-center gap-1 text-xs font-medium text-ink-secondary"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  <span>选择提问模式</span>
                </button>
                <div className="space-y-1.5">
                  {NOVEL_SCENARIOS.map((sc) => {
                    const active = novelScenario === sc.id;
                    return (
                      <button
                        key={sc.id}
                        type="button"
                        onClick={() => {
                          setNovelScenario(sc.id);
                          closeMobileTray();
                        }}
                        className={`flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left ${
                          active
                            ? "border-accent bg-accent-soft/50"
                            : "border-line bg-surface"
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-ink">
                            {sc.label}
                          </div>
                          <div className="mt-0.5 text-[11px] text-ink-secondary">
                            {sc.hint}
                          </div>
                        </div>
                        {active && <Check className="h-4 w-4 shrink-0 text-accent" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {mobileTrayPanel === "model" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setMobileTrayPanel("grid")}
                    className="inline-flex items-center gap-1 text-xs font-medium text-ink-secondary"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    <span>切换对话模型</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      closeMobileTray();
                      onOpenSettings();
                    }}
                    className="text-[11px] font-medium text-accent"
                  >
                    模型设置
                  </button>
                </div>
                {providers.length === 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      closeMobileTray();
                      onOpenSettings();
                    }}
                    className="w-full rounded-xl border border-dashed border-line bg-surface py-4 text-xs font-medium text-accent"
                  >
                    尚未配置模型，点击前往配置 API Key
                  </button>
                ) : (
                  <div className="max-h-44 space-y-1.5 overflow-y-auto">
                    {providers.map((p) => {
                      const active = selectedProviderId === p.id;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => {
                            selectProvider(p.id);
                            closeMobileTray();
                          }}
                          className={`flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-xs ${
                            active
                              ? "border-accent bg-accent-soft/50 text-ink"
                              : "border-line bg-surface text-ink-secondary"
                          }`}
                        >
                          <span className="truncate font-medium">
                            {p.name} · {p.model_name}
                          </span>
                          {active && <Check className="h-4 w-4 shrink-0 text-accent" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {mobileTrayPanel === "templates" && (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setMobileTrayPanel("grid")}
                  className="inline-flex items-center gap-1 text-xs font-medium text-ink-secondary"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  <span>快捷提问模板</span>
                </button>
                <div className="max-h-48 space-y-1.5 overflow-y-auto">
                  {commands.map((item) => (
                    <button
                      key={item.command}
                      type="button"
                      onClick={() => applyCommand(item)}
                      className="flex w-full items-center justify-between gap-2.5 rounded-xl border border-line bg-surface px-3 py-2 text-left text-xs"
                    >
                      <span className="font-mono font-semibold text-accent shrink-0">
                        {item.command}
                      </span>
                      <span className="flex-1 truncate text-ink-secondary">
                        {item.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ===== Desktop PC PromptBar (>= md): Full Workbench Composer ===== */}
      <div className="hidden md:block relative mx-auto w-full max-w-[780px]">
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
    </>
  );
}
