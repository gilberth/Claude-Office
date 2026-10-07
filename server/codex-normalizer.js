/**
 * Translate Codex App/CLI command hook stdin into Agent Office events.
 * A top-level Codex turn has no agent_id. Map those events to the permanent
 * assistant avatar (src/App.tsx) rather than dropping them.
 *
 * No tool inputs, prompts, file contents, or credentials are logged here.
 */
export const PRIMARY_ASSISTANT_ID = 'assistant-primary'

const ROLE_ALIASES = {
  explore: 'Explore',
  explorer: 'Explore',
  general: 'general-purpose',
  'general-purpose': 'general-purpose',
  worker: 'general-purpose',
  default: 'general-purpose',
  reviewer: 'code-reviewer',
  'code-reviewer': 'code-reviewer',
  frontend: 'frontend-developer',
  'frontend-developer': 'frontend-developer',
  fullstack: 'fullstack-developer',
  'fullstack-developer': 'fullstack-developer',
  tester: 'test-engineer',
  'test-engineer': 'test-engineer',
  security: 'security-auditor',
  'security-auditor': 'security-auditor',
  architect: 'architect-reviewer',
  'architect-reviewer': 'architect-reviewer',
  devops: 'devops-engineer',
  'devops-engineer': 'devops-engineer',
  dba: 'database-architect',
  'database-architect': 'database-architect',
  typescript: 'typescript-pro',
  'typescript-pro': 'typescript-pro',
  ai: 'ai-engineer',
  'ai-engineer': 'ai-engineer',
  debugger: 'debugger',
}

const ROLE_NAMES = {
  Explore: 'Explorer',
  'general-purpose': 'Codex Agent',
  'code-reviewer': 'Reviewer',
  'frontend-developer': 'Frontend',
  'fullstack-developer': 'Fullstack',
  'test-engineer': 'Tester',
  'security-auditor': 'Security',
  'architect-reviewer': 'Architect',
  'devops-engineer': 'DevOps',
  'database-architect': 'DBA',
  'typescript-pro': 'TS Pro',
  'ai-engineer': 'AI Eng',
  debugger: 'Debugger',
}

function roleFor(value) {
  const key = typeof value === 'string' ? value.trim().toLowerCase().replace(/_/g, '-') : ''
  return ROLE_ALIASES[key] ?? 'general-purpose'
}

function safeLabel(value, fallback = 'tool', max = 64) {
  return typeof value === 'string' && value.trim()
    ? value.trim().replace(/[\r\n\t]/g, ' ').slice(0, max)
    : fallback
}

function toolActivity(toolName, input) {
  const tool = safeLabel(toolName)
  const key = tool.toLowerCase()
  const arg = input && typeof input === 'object' ? input : {}

  if (key.includes('shell') || key.includes('exec_command') || key === 'bash' || key === 'command') {
    return 'using terminal'
  }
  if (key.includes('patch') || key.includes('write') || key.includes('edit')) {
    const file = typeof arg.file_path === 'string' ? arg.file_path.split('/').pop() : ''
    return file ? `editing ${safeLabel(file, 'file', 48)}` : 'editing code'
  }
  if (key.includes('read') || key.includes('open')) return 'reading files'
  if (key.includes('search') || key.includes('grep') || key.includes('find')) return 'searching code'
  if (key.includes('web') || key.includes('browser')) return 'researching'
  return `using ${tool}`
}

function parseMcpTool(toolName) {
  const name = typeof toolName === 'string' ? toolName : ''
  if (!name.startsWith('mcp__')) return null
  const pieces = name.slice('mcp__'.length).split('__')
  if (pieces.length < 2 || !pieces[0] || !pieces[1]) return null
  return { server: safeLabel(pieces[0]), tool: safeLabel(pieces.slice(1).join('__')) }
}

function eventBase(payload, agentId) {
  return {
    provider: 'codex',
    sessionId: typeof payload.session_id === 'string' ? payload.session_id : undefined,
    turnId: typeof payload.turn_id === 'string' ? payload.turn_id : undefined,
    agentId,
  }
}

export function normalizeCodexHook(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return []

  const event = payload.hook_event_name
  const agentId = typeof payload.agent_id === 'string' && payload.agent_id.trim()
    ? payload.agent_id
    : PRIMARY_ASSISTANT_ID
  const base = eventBase(payload, agentId)
  const toolName = safeLabel(payload.tool_name)
  const isSubagent = agentId !== PRIMARY_ASSISTANT_ID

  switch (event) {
    case 'SubagentStart': {
      if (!isSubagent) return []
      const role = roleFor(payload.agent_type)
      return [{
        ...base,
        type: 'agent_spawned',
        agent: {
          id: agentId,
          name: ROLE_NAMES[role] ?? 'Codex Agent',
          role,
          task: `${safeLabel(payload.agent_type, 'subagent')} · ${safeLabel(payload.model, 'Codex')}`,
        },
      }]
    }

    case 'SubagentStop':
      return isSubagent
        ? [{ ...base, type: 'agent_completed',
            result: typeof payload.last_assistant_message === 'string'
              ? payload.last_assistant_message.slice(0, 180)
              : 'completed' }]
        : []

    case 'SessionStart':
      return [{ ...base, type: 'agent_idle', agentId: PRIMARY_ASSISTANT_ID, status: 'session ready' }]

    case 'UserPromptSubmit':
      return [{ ...base, type: 'agent_working', agentId: PRIMARY_ASSISTANT_ID, status: 'thinking about request' }]

    case 'Stop':
      return [{ ...base, type: 'agent_idle', status: 'waiting for next request' }]

    case 'SessionEnd':
      return [{ ...base, type: 'agent_idle', agentId: PRIMARY_ASSISTANT_ID, status: 'session ended' }]

    case 'Interrupt':
      return [{ ...base, type: 'agent_idle', status: 'interrupted' }]

    case 'PreToolUse':
    case 'PostToolUse':
    case 'PermissionRequest': {
      const status = event === 'PermissionRequest'
        ? `waiting for approval: ${toolName}`
        : event === 'PostToolUse'
          ? `finished ${toolName}`
          : toolActivity(toolName, payload.tool_input)
      const result = [{ ...base, type: 'agent_working', status }]
      const mcp = parseMcpTool(payload.tool_name)
      if (mcp && event !== 'PermissionRequest') {
        result.push({
          ...base,
          type: event === 'PreToolUse' ? 'mcp_call' : 'mcp_done',
          server: mcp.server,
          tool: mcp.tool,
        })
      }
      return result
    }

    default:
      return []
  }
}
