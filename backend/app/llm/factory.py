from __future__ import annotations

import time
from typing import Any

from app.llm.anthropic import AnthropicAdapter
from app.llm.base import BaseLLMAdapter, LLMMessage, ToolDefinition
from app.llm.gemini import GeminiAdapter
from app.llm.openai_compat import OpenAICompatAdapter


def create_adapter(
    protocol: str,
    base_url: str,
    api_key: str,
    model_name: str,
    timeout: float = 120.0,
) -> BaseLLMAdapter:
    if protocol == "openai_compat":
        return OpenAICompatAdapter(base_url, api_key, model_name, timeout=timeout)
    if protocol == "anthropic":
        return AnthropicAdapter(base_url, api_key, model_name, timeout=timeout)
    if protocol == "gemini":
        return GeminiAdapter(base_url, api_key, model_name, timeout=timeout)
    raise ValueError(f"Unsupported LLM protocol: {protocol}")


async def test_provider_connection(
    protocol: str,
    base_url: str,
    api_key: str,
    model_name: str,
) -> dict[str, Any]:
    """Two-stage provider check: (1) basic connectivity and (2) native tool-calling support."""
    adapter = create_adapter(protocol, base_url, api_key, model_name, timeout=30.0)
    t0 = time.monotonic()

    try:
        reply = await adapter.complete_once(
            messages=[LLMMessage(role="user", content="Reply with exactly OK.")],
            system_prompt="You are a connection health check.",
            temperature=0.0,
        )
    except Exception as exc:
        return {
            "connectivity_ok": False,
            "latency_ms": int((time.monotonic() - t0) * 1000),
            "supports_tools": False,
            "recommended_react_fallback": True,
            "detail": f"Connectivity failed: {exc}",
        }

    latency_ms = int((time.monotonic() - t0) * 1000)

    probe_tool = ToolDefinition(
        name="ping_probe",
        description="Call this tool with value='pong' to verify tool calling works.",
        parameters={
            "type": "object",
            "properties": {"value": {"type": "string"}},
            "required": ["value"],
        },
    )
    supports_tools = False
    tool_detail = "Model responded to text but did not invoke the test tool; ReAct fallback recommended."
    try:
        saw_tool = False
        async for ev in adapter.stream_chat(
            messages=[LLMMessage(role="user", content="Please call the ping_probe tool with value='pong'.")],
            tools=[probe_tool],
            system_prompt="Always call ping_probe when asked.",
            temperature=0.0,
        ):
            if ev.type == "tool_call" and ev.tool_call and ev.tool_call.name == "ping_probe":
                saw_tool = True
        if saw_tool:
            supports_tools = True
            tool_detail = f"Connectivity and native tool calling verified (echo: {reply.strip()[:40]})."
    except Exception as exc:
        tool_detail = f"Connectivity OK, tool calling check raised error ({exc}); ReAct fallback recommended."

    return {
        "connectivity_ok": True,
        "latency_ms": latency_ms,
        "supports_tools": supports_tools,
        "recommended_react_fallback": not supports_tools,
        "detail": tool_detail,
    }
