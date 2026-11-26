from __future__ import annotations

import json
from typing import Any, AsyncIterator, Callable

from app.agent.react_fallback import build_react_system_suffix, parse_react_tool_calls
from app.llm.base import BaseLLMAdapter, LLMMessage, ToolCall, ToolDefinition

MAX_TOOL_ROUNDS = 5
MAX_TOOL_CHARS = 18_000


def _truncate_tool_output(payload: Any, remaining_budget: int) -> str:
    raw = json.dumps(payload, ensure_ascii=False)
    if len(raw) <= remaining_budget:
        return raw
    if remaining_budget <= 80:
        return json.dumps({"truncated": True, "note": "Tool character budget reached."}, ensure_ascii=False)
    cut = raw[: remaining_budget - 40]
    return cut + ' ... [TRUNCATED_BY_BUDGET]"}'


async def run_tool_agent_loop(
    adapter: BaseLLMAdapter,
    messages: list[LLMMessage],
    tools: list[ToolDefinition],
    system_prompt: str,
    executor: Callable[[str, dict[str, Any]], Any],
    use_react_fallback: bool = False,
) -> AsyncIterator[dict[str, Any]]:
    """
    Bounded multi-round tool-calling loop shared by Novel and Document agents.

    Yields dicts:
      {"event": "tool_start", "data": {...}}
      {"event": "tool_done", "data": {...}}
      {"event": "delta", "data": {"text": "..."}}
      {"event": "_final", "answer": str, "tool_trace": list[dict]}
    """
    working_messages = list(messages)
    tool_trace: list[dict[str, Any]] = []
    answer_chunks: list[str] = []
    used_tool_chars = 0

    effective_system = system_prompt
    if use_react_fallback and tools:
        effective_system = system_prompt + build_react_system_suffix(tools)

    for round_idx in range(1, MAX_TOOL_ROUNDS + 1):
        budget_exhausted = used_tool_chars >= MAX_TOOL_CHARS
        active_tools = None if (use_react_fallback or budget_exhausted or not tools) else tools

        round_text_parts: list[str] = []
        round_tool_calls: list[ToolCall] = []

        async for ev in adapter.stream_chat(
            messages=working_messages,
            tools=active_tools,
            system_prompt=effective_system,
            temperature=0.3,
        ):
            if ev.type == "text_delta" and ev.text:
                round_text_parts.append(ev.text)
                if not use_react_fallback:
                    yield {"event": "delta", "data": {"text": ev.text}}
            elif ev.type == "tool_call" and ev.tool_call is not None:
                round_tool_calls.append(ev.tool_call)

        round_text = "".join(round_text_parts)

        if use_react_fallback and not budget_exhausted and tools:
            parsed_calls, clean_text = parse_react_tool_calls(round_text)
            if parsed_calls:
                round_tool_calls = parsed_calls
                round_text = clean_text
            else:
                if round_text:
                    answer_chunks.append(round_text)
                    yield {"event": "delta", "data": {"text": round_text}}
                break
        elif not round_tool_calls:
            if round_text:
                answer_chunks.append(round_text)
            break

        # If we received tool calls, execute them (unless budget was somehow already hit)
        if round_text and not use_react_fallback:
            answer_chunks.append(round_text)

        working_messages.append(
            LLMMessage(
                role="assistant",
                content=round_text,
                tool_calls=[] if use_react_fallback else round_tool_calls,
            )
        )

        for tc in round_tool_calls:
            yield {
                "event": "tool_start",
                "data": {"round": round_idx, "tool": tc.name, "arguments": tc.arguments},
            }
            try:
                result_obj = executor(tc.name, tc.arguments)
            except Exception as exc:
                result_obj = {"error": str(exc)}

            remaining = max(0, MAX_TOOL_CHARS - used_tool_chars)
            result_str = _truncate_tool_output(result_obj, remaining)
            used_tool_chars += len(result_str)

            trace_entry = {
                "round": round_idx,
                "tool": tc.name,
                "arguments": tc.arguments,
                "result_chars": len(result_str),
            }
            tool_trace.append(trace_entry)
            yield {
                "event": "tool_done",
                "data": {
                    "round": round_idx,
                    "tool": tc.name,
                    "result_chars": len(result_str),
                    "total_tool_chars": used_tool_chars,
                },
            }

            if use_react_fallback:
                working_messages.append(
                    LLMMessage(
                        role="user",
                        content=f"<tool_result name=\"{tc.name}\">\n{result_str}\n</tool_result>",
                    )
                )
            else:
                working_messages.append(
                    LLMMessage(
                        role="tool",
                        content=result_str,
                        tool_call_id=tc.id,
                        tool_name=tc.name,
                    )
                )

        # If this was the 5th round or budget is now exhausted, force one final synthesis without tools
        if round_idx == MAX_TOOL_ROUNDS or used_tool_chars >= MAX_TOOL_CHARS:
            final_hint = (
                "已达到单轮检索工具调用或字符预算上限，请立即基于目前检索到的证据作答。"
            )
            working_messages.append(LLMMessage(role="user", content=final_hint))
            async for ev in adapter.stream_chat(
                messages=working_messages,
                tools=None,
                system_prompt=system_prompt,
                temperature=0.3,
            ):
                if ev.type == "text_delta" and ev.text:
                    answer_chunks.append(ev.text)
                    yield {"event": "delta", "data": {"text": ev.text}}
            break

    yield {
        "event": "_final",
        "answer": "".join(answer_chunks).strip(),
        "tool_trace": tool_trace,
    }
