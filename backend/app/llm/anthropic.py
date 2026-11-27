from __future__ import annotations

import base64
import json
from typing import Any, AsyncIterator

import httpx

from app.llm.base import BaseLLMAdapter, LLMMessage, StreamEvent, ToolCall, ToolDefinition


class AnthropicAdapter(BaseLLMAdapter):
    def _headers(self) -> dict[str, str]:
        return {
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }

    def _endpoint(self, suffix: str) -> str:
        base = self.base_url.rstrip("/")
        if base.endswith("/v1"):
            return f"{base}{suffix}"
        return f"{base}/v1{suffix}"

    @staticmethod
    def _format_messages(messages: list[LLMMessage]) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for msg in messages:
            if msg.role == "assistant" and msg.tool_calls:
                blocks: list[dict[str, Any]] = []
                if msg.content:
                    blocks.append({"type": "text", "text": msg.content})
                for tc in msg.tool_calls:
                    blocks.append(
                        {
                            "type": "tool_use",
                            "id": tc.id,
                            "name": tc.name,
                            "input": tc.arguments,
                        }
                    )
                out.append({"role": "assistant", "content": blocks})
            elif msg.role == "tool":
                block = {
                    "type": "tool_result",
                    "tool_use_id": msg.tool_call_id or "",
                    "content": msg.content,
                }
                if out and out[-1]["role"] == "user" and isinstance(out[-1]["content"], list):
                    out[-1]["content"].append(block)
                else:
                    out.append({"role": "user", "content": [block]})
            elif msg.images:
                img_blocks: list[dict[str, Any]] = []
                for img in msg.images:
                    b64 = base64.b64encode(img.data).decode("ascii")
                    img_blocks.append(
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": img.mime_type,
                                "data": b64,
                            },
                        }
                    )
                if msg.content:
                    img_blocks.append({"type": "text", "text": msg.content})
                out.append({"role": msg.role, "content": img_blocks})
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
            "max_tokens": 4096,
            "messages": self._format_messages(messages),
            "stream": True,
            "temperature": temperature,
        }
        if system_prompt:
            payload["system"] = system_prompt
        if tools:
            payload["tools"] = [
                {
                    "name": t.name,
                    "description": t.description,
                    "input_schema": t.parameters,
                }
                for t in tools
            ]

        active_blocks: dict[int, dict[str, str]] = {}
        completed_tools: list[ToolCall] = []
        stop_reason = ""

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            async with client.stream(
                "POST",
                self._endpoint("/messages"),
                headers=self._headers(),
                json=payload,
            ) as resp:
                if resp.status_code >= 400:
                    body = (await resp.aread()).decode("utf-8", errors="replace")
                    raise RuntimeError(f"Anthropic API error {resp.status_code}: {body[:500]}")

                async for line in resp.aiter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    data_str = line[5:].strip()
                    try:
                        ev = json.loads(data_str)
                    except json.JSONDecodeError:
                        continue

                    ev_type = ev.get("type")
                    if ev_type == "content_block_start":
                        idx = int(ev.get("index", 0))
                        block = ev.get("content_block") or {}
                        if block.get("type") == "tool_use":
                            active_blocks[idx] = {
                                "id": str(block.get("id", f"toolu_{idx}")),
                                "name": str(block.get("name", "")),
                                "json": "",
                            }
                    elif ev_type == "content_block_delta":
                        idx = int(ev.get("index", 0))
                        delta = ev.get("delta") or {}
                        if delta.get("type") == "text_delta" and delta.get("text"):
                            yield StreamEvent(type="text_delta", text=str(delta["text"]))
                        elif delta.get("type") == "input_json_delta" and idx in active_blocks:
                            active_blocks[idx]["json"] += str(delta.get("partial_json", ""))
                    elif ev_type == "content_block_stop":
                        idx = int(ev.get("index", 0))
                        if idx in active_blocks:
                            blk = active_blocks.pop(idx)
                            raw_json = blk["json"]
                            try:
                                parsed = json.loads(raw_json) if raw_json.strip() else {}
                            except json.JSONDecodeError:
                                parsed = {}
                            completed_tools.append(
                                ToolCall(
                                    id=blk["id"],
                                    name=blk["name"],
                                    arguments=parsed if isinstance(parsed, dict) else {},
                                    raw_arguments=raw_json,
                                )
                            )
                    elif ev_type == "message_delta":
                        sr = (ev.get("delta") or {}).get("stop_reason")
                        if sr:
                            stop_reason = str(sr)

        for tc in completed_tools:
            yield StreamEvent(type="tool_call", tool_call=tc)
        yield StreamEvent(type="done", finish_reason=stop_reason)

    async def fetch_models(self) -> list[str]:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(self._endpoint("/models"), headers=self._headers())
            if resp.status_code >= 400:
                raise RuntimeError(f"Failed to fetch Anthropic models ({resp.status_code}): {resp.text[:300]}")
            data = resp.json()
        items = data.get("data") or []
        models = [str(m["id"]) for m in items if isinstance(m, dict) and m.get("id")]
        return sorted(set(models))
