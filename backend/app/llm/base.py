from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, AsyncIterator


@dataclass
class ToolDefinition:
    name: str
    description: str
    parameters: dict[str, Any]


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict[str, Any] = field(default_factory=dict)
    raw_arguments: str = ""


@dataclass
class ImageAttachment:
    data: bytes
    mime_type: str = "image/png"


@dataclass
class LLMMessage:
    role: str  # 'user' | 'assistant' | 'tool'
    content: str = ""
    images: list[ImageAttachment] = field(default_factory=list)
    tool_calls: list[ToolCall] = field(default_factory=list)
    tool_call_id: str | None = None
    tool_name: str | None = None


@dataclass
class StreamEvent:
    type: str  # 'text_delta' | 'tool_call' | 'done'
    text: str = ""
    tool_call: ToolCall | None = None
    finish_reason: str = ""


class BaseLLMAdapter(ABC):
    def __init__(
        self,
        base_url: str,
        api_key: str,
        model_name: str,
        timeout: float = 120.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model_name = model_name
        self.timeout = timeout

    @abstractmethod
    async def stream_chat(
        self,
        messages: list[LLMMessage],
        tools: list[ToolDefinition] | None = None,
        system_prompt: str = "",
        temperature: float = 0.3,
    ) -> AsyncIterator[StreamEvent]:
        """Yield StreamEvent items as the model responds."""
        if False:
            yield StreamEvent(type="done")

    async def complete_once(
        self,
        messages: list[LLMMessage],
        system_prompt: str = "",
        temperature: float = 0.3,
    ) -> str:
        chunks: list[str] = []
        async for ev in self.stream_chat(
            messages=messages,
            tools=None,
            system_prompt=system_prompt,
            temperature=temperature,
        ):
            if ev.type == "text_delta" and ev.text:
                chunks.append(ev.text)
        return "".join(chunks)

    @abstractmethod
    async def fetch_models(self) -> list[str]:
        """Fetch available model IDs from the provider."""
