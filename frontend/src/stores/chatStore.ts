import { create } from "zustand";
import { chatApi } from "../api/chat";
import type {
  AppMode,
  ChatMessage,
  ChatSession,
  Citation,
  ToolTraceItem,
} from "../types/api";

interface ChatState {
  sessions: ChatSession[];
  activeSessionId: number | null;
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingText: string;
  streamingTools: ToolTraceItem[];
  streamingCitations: Citation[];
  error: string | null;
  abortController: AbortController | null;

  loadSessions: (mode: AppMode, targetId: number | null) => Promise<void>;
  selectSession: (sessionId: number) => Promise<void>;
  newSession: () => void;
  deleteSession: (sessionId: number) => Promise<void>;
  sendMessage: (params: {
    mode: AppMode;
    targetId: number;
    message: string;
    providerId?: number | null;
    maxChapter?: number | null;
  }) => Promise<void>;
  stopStreaming: () => void;
  clearError: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  messages: [],
  isStreaming: false,
  streamingText: "",
  streamingTools: [],
  streamingCitations: [],
  error: null,
  abortController: null,

  loadSessions: async (mode, targetId) => {
    if (!targetId) {
      set({ sessions: [], activeSessionId: null, messages: [] });
      return;
    }
    try {
      const sessions = await chatApi.listSessions(mode, targetId);
      const current = get().activeSessionId;
      const stillValid = current && sessions.some((s) => s.id === current);
      if (stillValid && current) {
        set({ sessions });
      } else {
        const firstId = sessions[0]?.id ?? null;
        set({ sessions, activeSessionId: firstId, messages: [] });
        if (firstId) {
          await get().selectSession(firstId);
        }
      }
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "加载对话历史失败" });
    }
  },

  selectSession: async (sessionId) => {
    set({ activeSessionId: sessionId, error: null });
    try {
      const messages = await chatApi.listMessages(sessionId);
      set({ messages });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "加载消息失败" });
    }
  },

  newSession: () => {
    get().stopStreaming();
    set({
      activeSessionId: null,
      messages: [],
      streamingText: "",
      streamingTools: [],
      streamingCitations: [],
      error: null,
    });
  },

  deleteSession: async (sessionId) => {
    try {
      await chatApi.deleteSession(sessionId);
      const remaining = get().sessions.filter((s) => s.id !== sessionId);
      const wasActive = get().activeSessionId === sessionId;
      set({
        sessions: remaining,
        activeSessionId: wasActive ? (remaining[0]?.id ?? null) : get().activeSessionId,
        messages: wasActive ? [] : get().messages,
      });
      if (wasActive && remaining[0]) {
        await get().selectSession(remaining[0].id);
      }
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

  sendMessage: async ({ mode, targetId, message, providerId, maxChapter }) => {
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
      messages: [...s.messages, optimisticUserMsg],
      isStreaming: true,
      streamingText: "",
      streamingTools: [],
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
        set({
          sessions,
          activeSessionId: resolvedSessionId,
          messages,
          isStreaming: false,
          streamingText: "",
          streamingTools: [],
          streamingCitations: [],
          abortController: null,
        });
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
