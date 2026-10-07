#!/usr/bin/env bash
# =============================================================================
# install-codex-hooks.sh — Add Agent Office hooks to ~/.codex/hooks.json
#
# Supports Codex App and Codex CLI because both load user hooks from
# $CODEX_HOME/hooks.json (default: ~/.codex/hooks.json).
# =============================================================================

set -euo pipefail

CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
HOOKS_FILE="$CODEX_HOME/hooks.json"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TRACKER_SCRIPT="$SCRIPT_DIR/codex-agent-tracker.py"
HOOK_COMMAND="python3 \"$TRACKER_SCRIPT\""

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RESET='\033[0m'

echo ""
echo -e "${CYAN}╔═══════════════════════════════════════════╗${RESET}"
echo -e "${CYAN}║    Agent Office — Codex Hook Installer    ║${RESET}"
echo -e "${CYAN}╚═══════════════════════════════════════════╝${RESET}"
echo ""

if [ ! -f "$TRACKER_SCRIPT" ]; then
  echo -e "${RED}[error]${RESET} Tracker not found: $TRACKER_SCRIPT"
  exit 1
fi

chmod +x "$TRACKER_SCRIPT"
mkdir -p "$CODEX_HOME"

if [ ! -f "$HOOKS_FILE" ]; then
  echo '{}' > "$HOOKS_FILE"
  echo -e "${YELLOW}[info]${RESET} Created $HOOKS_FILE"
fi

BACKUP_FILE="${HOOKS_FILE}.backup.$(date +%Y%m%d_%H%M%S)"
cp "$HOOKS_FILE" "$BACKUP_FILE"
echo -e "${GREEN}[ok]${RESET} Backup: $BACKUP_FILE"

python3 - "$HOOKS_FILE" "$HOOK_COMMAND" <<'PYEOF'
import json
import sys

path = sys.argv[1]
command = sys.argv[2]

try:
    with open(path, "r", encoding="utf-8") as f:
        config = json.load(f)
except (OSError, json.JSONDecodeError):
    config = {}

hooks = config.setdefault("hooks", {})

events = [
    "SubagentStart",
    "SubagentStop",
    "PreToolUse",
    "PostToolUse",
    "PermissionRequest",
    "SessionStart",
    "UserPromptSubmit",
    "SessionEnd",
    "Stop",
    "Interrupt",
]

for event_name in events:
    groups = hooks.setdefault(event_name, [])
    if not isinstance(groups, list):
        groups = []
        hooks[event_name] = groups

    already = False
    for group in groups:
        if not isinstance(group, dict):
            continue
        for hook in group.get("hooks", []):
            if isinstance(hook, dict) and hook.get("command") == command:
                already = True
                break
        if already:
            break

    if not already:
        groups.append({
            "hooks": [{
                "type": "command",
                "command": command,
                "async": True,
                "timeout": 5
            }]
        })

with open(path, "w", encoding="utf-8") as f:
    json.dump(config, f, indent=2)
    f.write("\n")
PYEOF

echo -e "${GREEN}[ok]${RESET} Codex hooks installed in $HOOKS_FILE"
echo ""
echo "Events:"
echo "  SubagentStart / SubagentStop"
echo "  PreToolUse / PostToolUse / PermissionRequest"
echo "  SessionStart / UserPromptSubmit / SessionEnd / Stop / Interrupt"
echo ""
echo "Next:"
echo "  1. Start Agent Office: bash scripts/start-office.sh"
echo "  2. Restart Codex App or start a new Codex CLI session"
echo "  3. If Codex asks you to trust/review command hooks, approve this tracker"
echo ""
echo -e "${YELLOW}Note:${RESET} The hook is best-effort. If port 3334 is not running,"
echo "Codex continues normally."
