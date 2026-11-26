from __future__ import annotations

import json
import uuid
from typing import Any, AsyncIterator

import httpx

from app.llm.base import BaseLLMAdapter, LLMMessage, StreamEvent, ToolCall, ToolDefinition


def _normalize_openai_base(base_url: str) -> str:
    url = base_url.rstrip("/")
    if not url.endswith("/v1") and "/v1/" not in url and not url.endswith("/openai"):
        # Most relays take .../v1; keep explicit /v1 if user omitted path or only provided host
        parsed = httpx.URL(url)
        if parsed.path in ("", "/"):
            return url + "/v1"
    return url


class OpenAICompatAdapter(BaseLLMAdapter):
    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def _endpoint(self, suffix: str) -> str:
        base = _normalize_openai_base(self.base_url)
        return f"{base}{suffix}"

    @staticmethod
    def _format_messages(messages: list[LLMMessage], system_prompt: str) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        if system_prompt:
            out.append({"role": "system", "content": system_prompt})
        for msg in messages:
            if msg.role == "assistant" and msg.tool_calls:
                out.append(
                    {
                        "role": "assistant",
                        "content": msg.content or None,
                        "tool_calls": [
                            {
                                "id": tc.id,
                                "type": "function",
                                "function": {
                                    "name": tc.name,
                                    "arguments": json.dumps(tc.arguments, ensure_ascii=False),
                                },
                            }
                            for tc in msg.tool_calls
                        ],
                    }
                )
            elif msg.role == "tool":
                out.append(
                    {
                        "role": "tool",
                        "tool_call_id": msg.tool_call_id or "",
                        "content": msg.content,
                    }
                )
            else:
                out.append({"role": msg.role, "content": msg.content})
        return out

    async def stream_chat(
        self,
        messages: list[LLMMessage],
        tools: list[ToolDefinition] | None = None,
        system_prompt: str = "",
        temperature: float = 0.3,
    ) -> AsyncIterator[StreamEvent]:
        payload: dict[str, Any] = {
            "model": self.model_name,
            "messages": self._format_messages(messages, system_prompt),
            "stream": True,
            "temperature": temperature,
        }
        if tools:
            payload["tools"] = [
                {
                    "type": "function",
                    "function": {
                        "name": t.name,
                        "description": t.description,
                        "parameters": t.parameters,
                    },
                }
                for t in tools
            ]

        tool_acc: dict[int, dict[str, str]] = {}
        finish_reason = ""

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            async with client.stream(
                "POST",
                self._endpoint("/chat/completions"),
                headers=self._headers(),
                json=payload,
            ) as resp:
                if resp.status_code >= 400:
                    body = (await resp.aread()).decode("utf-8", errors="replace")
                    raise RuntimeError(f"OpenAI-compat API error {resp.status_code}: {body[:500]}")

                async for line in resp.aiter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    data_str = line[5:].strip()
                    if data_str == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data_str)
                    except json.JSONDecodeError:
                        continue

                    choices = chunk.get("choices") or []
                    if not choices:
                        continue
                    choice = choices[0]
                    if choice.get("finish_reason"):
                        finish_reason = str(choice["finish_reason"])
                    delta = choice.get("delta") or {}

                    content = delta.get("content")
                    if content:
                        yield StreamEvent(type="text_delta", text=str(content))

                    for tc_delta in delta.get("tool_calls") or []:
                        idx = int(tc_delta.get("index", 0))
                        entry = tool_acc.setdefault(
                            idx,
                            {"id": f"call_{uuid.uuid4().hex[:8]}", "name": "", "arguments": ""},
                        )
                        if tc_delta.get("id"):
                            entry["id"] = str(tc_delta["id"])
                        fn = tc_delta.get("function") or {}
                        if fn.get("name"):
                            entry["name"] += str(fn["name"])
                        if fn.get("arguments"):
                            entry["arguments"] += str(fn["arguments"])

        for idx in sorted(tool_acc.keys()):
            entry = tool_acc[idx]
            raw_args = entry["arguments"]
            try:
                parsed_args = json.loads(raw_args) if raw_args.strip() else {}
            except json.JSONDecodeError:
                parsed_args = {}
            yield StreamEvent(
                type="tool_call",
                tool_call=ToolCall(
                    id=entry["id"],
                    name=entry["name"],
                    arguments=parsed_args if isinstance(parsed_args, dict) else {},
                    raw_arguments=raw_args,
                ),
            )

        yield StreamEvent(type="done", finish_reason=finish_reason)

    async def fetch_models(self) -> list[str]:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(self._endpoint("/models"), headers=self._headers())
            if resp.status_code >= 400:
                raise RuntimeError(f"Failed to fetch models ({resp.status_code}): {resp.text[:300]}")
            data = resp.json()
        items = data.get("data") or []
        models = [str(m["id"]) for m in items if isinstance(m, dict) and m.get("id")]
        return sorted(set(models))
