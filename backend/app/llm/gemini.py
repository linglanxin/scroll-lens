from __future__ import annotations

import json
import uuid
from typing import Any, AsyncIterator

import httpx

from app.llm.base import BaseLLMAdapter, LLMMessage, StreamEvent, ToolCall, ToolDefinition


class GeminiAdapter(BaseLLMAdapter):
    def _headers(self) -> dict[str, str]:
        return {
            "x-goog-api-key": self.api_key,
            "Content-Type": "application/json",
        }

    def _base(self) -> str:
        base = self.base_url.rstrip("/")
        if base.endswith("/v1beta"):
            return base
        return f"{base}/v1beta"

    @staticmethod
    def _format_contents(messages: list[LLMMessage]) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for msg in messages:
            if msg.role == "assistant":
                parts: list[dict[str, Any]] = []
                if msg.content:
                    parts.append({"text": msg.content})
                for tc in msg.tool_calls:
                    parts.append({"functionCall": {"name": tc.name, "args": tc.arguments}})
                out.append({"role": "model", "parts": parts or [{"text": ""}]})
            elif msg.role == "tool":
                part = {
                    "functionResponse": {
                        "name": msg.tool_name or "tool",
                        "response": {"result": msg.content},
                    }
                }
                if out and out[-1]["role"] == "user" and "functionResponse" in out[-1]["parts"][0]:
                    out[-1]["parts"].append(part)
                else:
                    out.append({"role": "user", "parts": [part]})
            else:
                out.append({"role": "user", "parts": [{"text": msg.content}]})
        return out

    async def stream_chat(
        self,
        messages: list[LLMMessage],
        tools: list[ToolDefinition] | None = None,
        system_prompt: str = "",
        temperature: float = 0.3,
    ) -> AsyncIterator[StreamEvent]:
        payload: dict[str, Any] = {
            "contents": self._format_contents(messages),
            "generationConfig": {"temperature": temperature},
        }
        if system_prompt:
            payload["systemInstruction"] = {"parts": [{"text": system_prompt}]}
        if tools:
            payload["tools"] = [
                {
                    "functionDeclarations": [
                        {
                            "name": t.name,
                            "description": t.description,
                            "parameters": t.parameters,
                        }
                        for t in tools
                    ]
                }
            ]

        url = f"{self._base()}/models/{self.model_name}:streamGenerateContent?alt=sse"
        tool_calls: list[ToolCall] = []
        finish_reason = ""

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            async with client.stream(
                "POST",
                url,
                headers=self._headers(),
                json=payload,
            ) as resp:
                if resp.status_code >= 400:
                    body = (await resp.aread()).decode("utf-8", errors="replace")
                    raise RuntimeError(f"Gemini API error {resp.status_code}: {body[:500]}")

                async for line in resp.aiter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    data_str = line[5:].strip()
                    try:
                        chunk = json.loads(data_str)
                    except json.JSONDecodeError:
                        continue

                    candidates = chunk.get("candidates") or []
                    if not candidates:
                        continue
                    cand = candidates[0]
                    if cand.get("finishReason"):
                        finish_reason = str(cand["finishReason"])
                    parts = (cand.get("content") or {}).get("parts") or []
                    for part in parts:
                        if "text" in part and part["text"]:
                            yield StreamEvent(type="text_delta", text=str(part["text"]))
                        elif "functionCall" in part:
                            fc = part["functionCall"] or {}
                            args = fc.get("args") or {}
                            tool_calls.append(
                                ToolCall(
                                    id=f"gem_{uuid.uuid4().hex[:8]}",
                                    name=str(fc.get("name", "")),
                                    arguments=args if isinstance(args, dict) else {},
                                    raw_arguments=json.dumps(args, ensure_ascii=False),
                                )
                            )

        for tc in tool_calls:
            yield StreamEvent(type="tool_call", tool_call=tc)
        yield StreamEvent(type="done", finish_reason=finish_reason)

    async def fetch_models(self) -> list[str]:
        url = f"{self._base()}/models"
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(url, headers={"x-goog-api-key": self.api_key})
            if resp.status_code >= 400:
                raise RuntimeError(f"Failed to fetch Gemini models ({resp.status_code}): {resp.text[:300]}")
            data = resp.json()
        models: list[str] = []
        for m in data.get("models") or []:
            if isinstance(m, dict) and m.get("name"):
                name = str(m["name"])
                if name.startswith("models/"):
                    name = name[len("models/") :]
                models.append(name)
        return sorted(set(models))
