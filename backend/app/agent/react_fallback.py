from __future__ import annotations

import json
import re
import uuid

from app.llm.base import ToolCall, ToolDefinition

TOOL_CALL_BLOCK_RE = re.compile(r"<tool_call>\s*(\{.*?\})\s*</tool_call>", re.DOTALL)


def build_react_system_suffix(tools: list[ToolDefinition]) -> str:
    specs = []
    for t in tools:
        specs.append(
            f"- {t.name}: {t.description}\n"
            f"  参数 JSON Schema: {json.dumps(t.parameters, ensure_ascii=False)}"
        )
    joined = "\n".join(specs)
    return (
        "\n\n【文本工具调用协议（ReAct 降级模式）】\n"
        "当你需要调用工具查询资料时，请单独输出如下格式（不要放在代码块内）：\n"
        '<tool_call>{"name": "工具名", "arguments": {参数对象}}</tool_call>\n'
        "每次等待工具结果返回后再继续推理；若已获得足够证据，请直接用中文回答，不要输出 <tool_call>。\n"
        f"可用工具列表：\n{joined}\n"
    )


def parse_react_tool_calls(text: str) -> tuple[list[ToolCall], str]:
    """Extract <tool_call>{...}</tool_call> blocks and return (tool_calls, remaining_text)."""
    calls: list[ToolCall] = []
    for match in TOOL_CALL_BLOCK_RE.finditer(text):
        raw_json = match.group(1).strip()
        try:
            obj = json.loads(raw_json)
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict) and obj.get("name"):
            args = obj.get("arguments") or {}
            if not isinstance(args, dict):
                args = {}
            calls.append(
                ToolCall(
                    id=f"react_{uuid.uuid4().hex[:8]}",
                    name=str(obj["name"]),
                    arguments=args,
                    raw_arguments=raw_json,
                )
            )
    cleaned = TOOL_CALL_BLOCK_RE.sub("", text).strip()
    return calls, cleaned
