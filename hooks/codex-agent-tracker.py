#!/usr/bin/env python3
"""Codex App/CLI hook bridge for a source checkout (no third-party modules).

For packaged macOS installations the self-contained shell relay is used
instead. Both send the original Codex hook payload to the same server endpoint
so the primary agent and subagents are handled consistently.
"""

import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

ENDPOINT = os.environ.get("AGENT_OFFICE_URL", "http://127.0.0.1:3334/codex-event")
TOKEN_FILE = Path.home() / ".agent-office" / "auth-token"


def main() -> int:
    raw = sys.stdin.buffer.read()
    if not raw.strip():
        return 0

    try:
        token = TOKEN_FILE.read_text(encoding="utf-8").strip()
    except OSError:
        return 0

    if not token:
        return 0

    req = urllib.request.Request(
        ENDPOINT,
        data=raw,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {token}",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=1):
            pass
    except (urllib.error.URLError, TimeoutError, OSError):
        # Codex must not be slowed down or interrupted by an optional widget.
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
