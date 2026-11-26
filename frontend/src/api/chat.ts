import { apiFetch, getStoredToken } from "./client";
import type {
  AppMode,
  ChatMessage,
  ChatSession,
  ChatStreamRequest,
  Citation,
  SSEHandlers,
  ToolTraceItem,
} from "../types/api";

export const chatApi = {
  listSessions: (mode?: AppMode, targetId?: number) => {
    const qs = new URLSearchParams();
    if (mode) qs.set("mode", mode);
    if (targetId !== undefined) qs.set("target_id", String(targetId));
    const query = qs.toString() ? `?${qs}` : "";
    return apiFetch<ChatSession[]>(`/api/v1/chat/sessions${query}`);
  },

  renameSession: (sessionId: number, title: string) =>
    apiFetch<ChatSession>(`/api/v1/chat/sessions/${sessionId}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    }),

  deleteSession: (sessionId: number) =>
    apiFetch<{ deleted: boolean; session_id: number }>(
      `/api/v1/chat/sessions/${sessionId}`,
      { method: "DELETE" }
    ),

  listMessages: (sessionId: number) =>
    apiFetch<ChatMessage[]>(`/api/v1/chat/sessions/${sessionId}/messages`),

  async streamChat(
    req: ChatStreamRequest,
    handlers: SSEHandlers,
    signal?: AbortSignal
  ): Promise<void> {
    const token = getStoredToken();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const resp = await fetch("/api/v1/chat/stream", {
      method: "POST",
      headers,
      body: JSON.stringify(req),
      signal,
    });

    if (!resp.ok) {
      let detail = `HTTP ${resp.status}`;
      try {
        const err = (await resp.json()) as { detail?: string };
        if (err.detail) detail = err.detail;
      } catch {
        // ignore
      }
      throw new Error(detail);
    }

    if (!resp.body) {
      throw new Error("Empty SSE response stream");
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    const dispatchBlock = (rawBlock: string) => {
      const lines = rawBlock.split(/\r?\n/);
      let eventName = "message";
      const dataLines: string[] = [];

      for (const line of lines) {
        if (line.startsWith("event:")) {
          eventName = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trimStart());
        }
      }

      if (dataLines.length === 0) return;
      const rawData = dataLines.join("\n");
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(rawData) as Record<string, unknown>;
      } catch {
        return;
      }

      switch (eventName) {
        case "session":
          handlers.onSession?.(Number(parsed.session_id));
          break;
        case "tool_start":
          handlers.onToolStart?.(parsed as unknown as ToolTraceItem);
          break;
        case "tool_done":
          handlers.onToolDone?.(parsed as unknown as ToolTraceItem);
          break;
        case "delta":
          if (typeof parsed.text === "string") {
            handlers.onDelta?.(parsed.text);
          }
          break;
        case "citations":
          if (Array.isArray(parsed.citations)) {
            handlers.onCitations?.(parsed.citations as Citation[]);
          }
          break;
        case "done":
          handlers.onDone?.(parsed as unknown as { session_id: number; message_id: number });
          break;
        case "error":
          handlers.onError?.(String(parsed.detail || "Stream error"));
          break;
      }
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const parts = buffer.split(/\r?\n\r?\n/);
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        if (part.trim()) dispatchBlock(part);
      }
    }

    if (buffer.trim()) {
      dispatchBlock(buffer);
    }
  },
};
