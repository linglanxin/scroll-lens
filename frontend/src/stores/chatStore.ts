import { create } from "zustand";
import { chatApi } from "../api/chat";
import type {
  AppMode,
  ChatMessage,
  ChatSession,
  Citation,
  NovelCard,
  NovelScenario,
  ToolTraceItem,
} from "../types/api";

export type ChatViewMode = "overview" | "chat";

interface ChatState {
  sessions: ChatSession[];
  activeSessionId: number | null;
  chatView: ChatViewMode;
  loadingSessions: boolean;
  loadedTargetKey: string | null;
  mobileEntryNonce: number;
  focusMessageId: number | null;
  summarizingIds: Record<number, boolean>;
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingText: string;
  streamingTools: ToolTraceItem[];
  streamingCards: NovelCard[];
  streamingCitations: Citation[];
  error: string | null;
  abortController: AbortController | null;

  loadSessions: (mode: AppMode, targetId: number | null) => Promise<void>;
  openOverview: () => void;
  returnToChat: () => void;
  selectSession: (sessionId: number, focusMessageId?: number | null) => Promise<void>;
  clearFocusMessage: () => void;
  newSession: () => void;
  renameSession: (sessionId: number, title: string) => Promise<void>;
  summarizeSession: (
    sessionId: number,
    providerId?: number | null,
    options?: { silent?: boolean }
  ) => Promise<void>;
  deleteSession: (sessionId: number) => Promise<void>;
  sendMessage: (params: {
    mode: AppMode;
    targetId: number;
    message: string;
    providerId?: number | null;
    maxChapter?: number | null;
    scenario?: NovelScenario;
  }) => Promise<void>;
  stopStreaming: () => void;
  clearError: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  chatView: "overview",
  loadingSessions: false,
  loadedTargetKey: null,
  mobileEntryNonce: 0,
  focusMessageId: null,
  summarizingIds: {},
  messages: [],
  isStreaming: false,
  streamingText: "",
  streamingTools: [],
  streamingCards: [],
  streamingCitations: [],
  error: null,
  abortController: null,

  loadSessions: async (mode, targetId) => {
    if (!targetId) {
      get().stopStreaming();
      set({
        sessions: [],
        activeSessionId: null,
        chatView: "chat",
        loadingSessions: false,
        loadedTargetKey: null,
        focusMessageId: null,
        messages: [],
      });
      return;
    }

    const nextKey = `${mode}:${targetId}`;
    const targetChanged = get().loadedTargetKey !== nextKey;
    const isMobileViewport =
      typeof window !== "undefined" && window.innerWidth < 768;

    if (targetChanged) {
      get().stopStreaming();
      set((s) => ({
        loadedTargetKey: nextKey,
        mobileEntryNonce: s.mobileEntryNonce + 1,
        loadingSessions: true,
        sessions: [],
        activeSessionId: null,
        chatView: isMobileViewport ? "chat" : "overview",
        focusMessageId: null,
        messages: [],
        error: null,
      }));
    }

    try {
      const sessions = await chatApi.listSessions(mode, targetId);
      // Guard against rapid book/doc switching while requests are in flight
      if (get().loadedTargetKey !== nextKey) return;

      if (targetChanged) {
        set({
          sessions,
          activeSessionId: null,
          chatView: isMobileViewport
            ? "chat"
            : sessions.length > 0
              ? "overview"
              : "chat",
          loadingSessions: false,
          messages: [],
        });
      } else {
        const current = get().activeSessionId;
        const stillValid = current !== null && sessions.some((s) => s.id === current);
        set({
          sessions,
          loadingSessions: false,
          ...(stillValid ? {} : { activeSessionId: null }),
        });
      }
    } catch (err) {
      if (get().loadedTargetKey !== nextKey) return;
      set({
        loadingSessions: false,
        chatView: "chat",
        error: err instanceof Error ? err.message : "加载对话历史失败",
      });
    }
  },

  openOverview: () => {
    get().stopStreaming();
    set({
      chatView: "overview",
      focusMessageId: null,
      error: null,
    });
  },

  returnToChat: () => {
    set({
      chatView: "chat",
      error: null,
    });
  },

  selectSession: async (sessionId, focusMessageId) => {
    get().stopStreaming();
    const switchingSession = get().activeSessionId !== sessionId;
    set({
      activeSessionId: sessionId,
      chatView: "chat",
      focusMessageId: focusMessageId ?? null,
      error: null,
      ...(switchingSession ? { messages: [] } : {}),
    });
    try {
      const messages = await chatApi.listMessages(sessionId);
      if (get().activeSessionId === sessionId) {
        set({ messages });
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "加载消息失败" });
    }
  },

  clearFocusMessage: () => set({ focusMessageId: null }),

  newSession: () => {
    get().stopStreaming();
    set((s) => ({
      activeSessionId: null,
      chatView: "chat",
      mobileEntryNonce: s.mobileEntryNonce + 1,
      focusMessageId: null,
      messages: [],
      streamingText: "",
      streamingTools: [],
      streamingCards: [],
      streamingCitations: [],
      error: null,
    }));
  },

  renameSession: async (sessionId, title) => {
    try {
      const updated = await chatApi.renameSession(sessionId, title);
      set((s) => ({
        sessions: s.sessions.map((item) => (item.id === sessionId ? updated : item)),
      }));
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "重命名会话失败" });
    }
  },

  summarizeSession: async (sessionId, providerId, options) => {
    if (get().summarizingIds[sessionId]) return;
    set((s) => ({
      summarizingIds: { ...s.summarizingIds, [sessionId]: true },
    }));
    try {
      const updated = await chatApi.summarizeSession(sessionId, providerId);
      set((s) => ({
        sessions: s.sessions.map((item) => (item.id === sessionId ? updated : item)),
      }));
    } catch (err) {
      if (!options?.silent) {
        set({ error: err instanceof Error ? err.message : "生成 AI 总结失败" });
      }
    } finally {
      set((s) => {
        const next = { ...s.summarizingIds };
        delete next[sessionId];
        return { summarizingIds: next };
      });
    }
  },

  deleteSession: async (sessionId) => {
    try {
      await chatApi.deleteSession(sessionId);
      const remaining = get().sessions.filter((s) => s.id !== sessionId);
      const wasActive = get().activeSessionId === sessionId;
      set({
        sessions: remaining,
        activeSessionId: wasActive ? null : get().activeSessionId,
        messages: wasActive ? [] : get().messages,
        chatView: wasActive
          ? remaining.length > 0
            ? "overview"
            : "chat"
          : remaining.length === 0
            ? "chat"
            : get().chatView,
      });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "删除会话失败" });
    }
  },

  stopStreaming: () => {
    const ac = get().abortController;
    if (ac) {
      ac.abort();
      set({ abortController: null, isStreaming: false });
    }
  },

  sendMessage: async ({ mode, targetId, message, providerId, maxChapter, scenario }) => {
    const trimmed = message.trim();
    if (!trimmed || get().isStreaming) return;

    const ac = new AbortController();
    const optimisticUserMsg: ChatMessage = {
      id: Date.now(),
      session_id: get().activeSessionId ?? 0,
      role: "user",
      content: trimmed,
      tool_trace: [],
      citations: [],
      created_at: new Date().toISOString(),
    };

    set((s) => ({
      chatView: "chat",
      focusMessageId: null,
      messages: [...s.messages, optimisticUserMsg],
      isStreaming: true,
      streamingText: "",
      streamingTools: [],
      streamingCards: [],
      streamingCitations: [],
      error: null,
      abortController: ac,
    }));

    let resolvedSessionId = get().activeSessionId;

    try {
      await chatApi.streamChat(
        {
          mode,
          target_id: targetId,
          message: trimmed,
          session_id: resolvedSessionId,
          provider_id: providerId ?? null,
          max_chapter: mode === "novel" ? (maxChapter ?? null) : null,
          scenario: mode === "novel" ? (scenario ?? "verify") : undefined,
        },
        {
          onSession: (sid) => {
            resolvedSessionId = sid;
            set({ activeSessionId: sid });
          },
          onToolStart: (tool) => {
            set((s) => ({
              streamingTools: [...s.streamingTools, { ...tool, status: "running" }],
            }));
          },
          onToolDone: (tool) => {
            set((s) => {
              const next = [...s.streamingTools];
              const idx = next.findIndex(
                (item) =>
                  item.status === "running" &&
                  item.tool === tool.tool &&
                  item.round === tool.round
              );
              if (idx >= 0) {
                next[idx] = { ...next[idx], ...tool, status: "done" };
              } else {
                next.push({ ...tool, status: "done" });
              }
              return { streamingTools: next };
            });
          },
          onDelta: (text) => {
            set((s) => ({ streamingText: s.streamingText + text }));
          },
          onResetDraft: () => {
            set({ streamingText: "" });
          },
          onCards: (cards) => {
            set({ streamingCards: cards });
          },
          onCitations: (citations) => {
            set({ streamingCitations: citations });
          },
          onDone: ({ session_id }) => {
            resolvedSessionId = session_id;
          },
          onError: (detail) => {
            set({ error: detail });
          },
        },
        ac.signal
      );

      if (resolvedSessionId) {
        const [sessions, messages] = await Promise.all([
          chatApi.listSessions(mode, targetId),
          chatApi.listMessages(resolvedSessionId),
        ]);
        const targetKey = `${mode}:${targetId}`;
        if (get().loadedTargetKey !== targetKey) {
          set({ isStreaming: false, abortController: null });
          return;
        }
        set({
          sessions,
          activeSessionId: resolvedSessionId,
          chatView: "chat",
          messages,
          isStreaming: false,
          streamingText: "",
          streamingTools: [],
          streamingCards: [],
          streamingCitations: [],
          abortController: null,
        });

        const updatedSess = sessions.find((s) => s.id === resolvedSessionId);
        const qCount = updatedSess?.question_count ?? 0;
        if (
          updatedSess &&
          qCount >= 2 &&
          (updatedSess.summary_source !== "ai" || qCount % 3 === 0)
        ) {
          void get().summarizeSession(resolvedSessionId, providerId, { silent: true });
        }
      } else {
        set({ isStreaming: false, abortController: null });
      }
    } catch (err) {
      const isAbort = err instanceof Error && err.name === "AbortError";
      set({
        isStreaming: false,
        abortController: null,
        error: isAbort ? null : err instanceof Error ? err.message : "请求失败",
      });
    }
  },

  clearError: () => set({ error: null }),
}));
