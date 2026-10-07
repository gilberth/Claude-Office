#!/usr/bin/env python3
"""
codex-agent-tracker.py — Codex App/CLI Hook -> Agent Office bridge.

Reads one Codex hook payload as JSON from stdin and forwards a normalized
Agent Office event to http://127.0.0.1:3334/event.

Supported Codex hook events:
  - SubagentStart
  - SubagentStop
  - PreToolUse
  - PostToolUse
  - PermissionRequest
  - SessionStart
  - SessionEnd
  - Stop
  - Interrupt

The hook is intentionally best-effort: if Agent Office is not running, Codex
continues normally and this process exits successfully.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

SERVER_URL = os.environ.get("AGENT_OFFICE_URL", "http://127.0.0.1:3334/event")
TOKEN_FILE = Path.home() / ".agent-office" / "auth-token"


def read_payload() -> dict[str, Any]:
    try:
        raw = sys.stdin.read()
        return json.loads(raw) if raw.strip() else {}
    except Exception:
        return {}


def role_for(agent_type: str | None) -> str:
    if not agent_type:
        return "general-purpose"

    key = agent_type.strip()
    normalized = key.lower().replace("_", "-")

    aliases = {
        "explore": "Explore",
        "explorer": "Explore",
        "general": "general-purpose",
        "general-purpose": "general-purpose",
        "worker": "general-purpose",
        "default": "general-purpose",
        "reviewer": "code-reviewer",
        "code-reviewer": "code-reviewer",
        "frontend": "frontend-developer",
        "frontend-developer": "frontend-developer",
        "fullstack": "fullstack-developer",
        "fullstack-developer": "fullstack-developer",
        "tester": "test-engineer",
        "test-engineer": "test-engineer",
        "security": "security-auditor",
        "security-auditor": "security-auditor",
        "architect": "architect-reviewer",
        "architect-reviewer": "architect-reviewer",
        "devops": "devops-engineer",
        "devops-engineer": "devops-engineer",
        "dba": "database-architect",
        "database-architect": "database-architect",
        "typescript": "typescript-pro",
        "typescript-pro": "typescript-pro",
        "ai": "ai-engineer",
        "ai-engineer": "ai-engineer",
        "debugger": "debugger",
    }
    return aliases.get(normalized, "general-purpose")


def display_name(role: str, agent_type: str | None, agent_id: str | None) -> str:
    names = {
        "Explore": "Explorer",
        "general-purpose": "Codex Agent",
        "code-reviewer": "Reviewer",
        "frontend-developer": "Frontend",
        "fullstack-developer": "Fullstack",
        "test-engineer": "Tester",
        "security-auditor": "Security",
        "architect-reviewer": "Architect",
        "devops-engineer": "DevOps",
        "database-architect": "DBA",
        "typescript-pro": "TS Pro",
        "ai-engineer": "AI Eng",
        "debugger": "Debugger",
    }
    if role in names:
        return names[role]
    if agent_type:
        return agent_type
    return f"Codex {agent_id[-6:]}" if agent_id else "Codex Agent"


def short(value: Any, limit: int = 120) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        text = value
    else:
        try:
            text = json.dumps(value, ensure_ascii=False)
        except Exception:
            text = str(value)
    return " ".join(text.split())[:limit]


def parse_mcp_tool(tool_name: str) -> tuple[str, str] | None:
    if not tool_name.startswith("mcp__"):
        return None
    stripped = tool_name[len("mcp__") :]
    parts = stripped.split("__", 1)
    if len(parts) != 2:
        return None
    return parts[0], parts[1]


def tool_status(tool_name: str, tool_input: Any) -> str:
    inp = tool_input if isinstance(tool_input, dict) else {}
    lower = tool_name.lower()

    if "shell" in lower or lower in {"bash", "exec_command", "command"}:
        cmd = inp.get("command") or inp.get("cmd") or inp.get("script") or ""
        return f"terminal: {short(cmd, 72)}" if cmd else "using terminal"
    if lower in {"apply_patch", "patch"} or "patch" in lower:
        return "editing code"
    if "read" in lower:
        path = inp.get("file_path") or inp.get("path") or ""
        return f"reading {Path(path).name}" if path else "reading files"
    if "write" in lower or "edit" in lower:
        path = inp.get("file_path") or inp.get("path") or ""
        return f"editing {Path(path).name}" if path else "editing files"
    if "search" in lower or "grep" in lower or "find" in lower:
        query = inp.get("query") or inp.get("pattern") or ""
        return f"searching: {short(query, 60)}" if query else "searching"
    if "web" in lower:
        return "researching on the web"
    return f"using {tool_name}"


def normalize(d: dict[str, Any]) -> dict[str, Any] | None:
    event = d.get("hook_event_name", "")
    agent_id = d.get("agent_id")
    agent_type = d.get("agent_type")
    session_id = d.get("session_id", "")
    turn_id = d.get("turn_id", "")
    model = d.get("model", "")

    if event == "SubagentStart":
        role = role_for(agent_type)
        return {
            "type": "agent_spawned",
            "provider": "codex",
            "sessionId": session_id,
            "turnId": turn_id,
            "model": model,
            "agent": {
                "id": agent_id,
                "name": display_name(role, agent_type, agent_id),
                "role": role,
                "task": f"{agent_type or 'subagent'} · {model or 'Codex'}",
                "provider": "codex",
                "model": model,
            },
        }

    if event == "SubagentStop":
        result = d.get("last_assistant_message") or "completed"
        return {
            "type": "agent_completed",
            "provider": "codex",
            "sessionId": session_id,
            "turnId": turn_id,
            "agentId": agent_id,
            "result": short(result, 180) or "completed",
        }

    if event in {"PreToolUse", "PostToolUse", "PermissionRequest"}:
        tool_name = d.get("tool_name", "")
        mcp = parse_mcp_tool(tool_name)

        if mcp:
            server, tool = mcp
            return {
                "type": "mcp_call" if event != "PostToolUse" else "mcp_done",
                "provider": "codex",
                "sessionId": session_id,
                "turnId": turn_id,
                "agentId": agent_id,
                "server": server,
                "tool": tool,
            }

        if not agent_id:
            return None

        if event == "PermissionRequest":
            status = f"waiting for approval: {tool_name or 'tool'}"
        elif event == "PostToolUse":
            status = f"finished {tool_name or 'tool'}"
        else:
            status = tool_status(tool_name, d.get("tool_input"))

        return {
            "type": "agent_working",
            "provider": "codex",
            "sessionId": session_id,
            "turnId": turn_id,
            "agentId": agent_id,
            "status": status,
        }

    # Session-level hooks are currently observational. They are deliberately not
    # mapped to a fake worker because they do not identify a subagent.
    if event in {"SessionStart", "SessionEnd", "Stop", "Interrupt"}:
        return None

    return None


def send_event(event: dict[str, Any]) -> None:
    try:
        token = TOKEN_FILE.read_text(encoding="utf-8").strip()
    except Exception:
        return

    if not token:
        return

    body = json.dumps(event, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        SERVER_URL,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=0.8):
            pass
    except (urllib.error.URLError, TimeoutError, OSError):
        pass


def main() -> int:
    payload = read_payload()
    event = normalize(payload)
    if event:
        send_event(event)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
