import test from 'node:test'
import assert from 'node:assert/strict'

import { PRIMARY_ASSISTANT_ID, normalizeCodexHook } from './codex-normalizer.js'

test('main-agent tool hooks without agent_id animate permanent Codex assistant', () => {
  const [event] = normalizeCodexHook({
    hook_event_name: 'PreToolUse',
    session_id: 'thread-1',
    turn_id: 'turn-4',
    tool_name: 'functions.exec_command',
    tool_input: { command: 'echo SECRET_PASSWORD_123' },
  })
  assert.equal(event.type, 'agent_working')
  assert.equal(event.agentId, PRIMARY_ASSISTANT_ID)
  assert.equal(event.sessionId, 'thread-1')
  assert.match(event.status, /terminal/)
  assert.doesNotMatch(event.status, /SECRET_PASSWORD_123/)
})

test('main-agent PostToolUse remains visible rather than being dropped', () => {
  const [event] = normalizeCodexHook({
    hook_event_name: 'PostToolUse',
    tool_name: 'apply_patch',
  })
  assert.deepEqual(
    { type: event.type, id: event.agentId, status: event.status },
    { type: 'agent_working', id: PRIMARY_ASSISTANT_ID, status: 'finished apply_patch' },
  )
})

test('main prompt starts activity and stop returns assistant to idle', () => {
  const [start] = normalizeCodexHook({ hook_event_name: 'UserPromptSubmit', session_id: 'thread-2' })
  const [stop] = normalizeCodexHook({ hook_event_name: 'Stop', session_id: 'thread-2' })
  assert.equal(start.type, 'agent_working')
  assert.equal(start.agentId, PRIMARY_ASSISTANT_ID)
  assert.equal(stop.type, 'agent_idle')
  assert.equal(stop.agentId, PRIMARY_ASSISTANT_ID)
})

test('SessionStart, SessionEnd and Interrupt update visible assistant status', () => {
  for (const hook of ['SessionStart', 'SessionEnd', 'Interrupt']) {
    const [event] = normalizeCodexHook({ hook_event_name: hook })
    assert.equal(event.type, 'agent_idle')
    assert.equal(event.agentId, PRIMARY_ASSISTANT_ID)
  }
})

test('subagent lifecycle maps to stable identity and expected role', () => {
  const [spawn] = normalizeCodexHook({
    hook_event_name: 'SubagentStart',
    agent_id: 'sub-abc',
    agent_type: 'code-reviewer',
    model: 'model-1',
    session_id: 'thread-3',
  })
  assert.equal(spawn.type, 'agent_spawned')
  assert.equal(spawn.agent.id, 'sub-abc')
  assert.equal(spawn.agent.role, 'code-reviewer')
  assert.equal(spawn.agent.name, 'Reviewer')
  assert.equal(spawn.sessionId, 'thread-3')

  const [work] = normalizeCodexHook({
    hook_event_name: 'PreToolUse',
    agent_id: 'sub-abc',
    tool_name: 'apply_patch',
  })
  assert.equal(work.agentId, 'sub-abc')
  assert.match(work.status, /editing/)

  const [stop] = normalizeCodexHook({
    hook_event_name: 'SubagentStop',
    agent_id: 'sub-abc',
    last_assistant_message: 'task complete',
  })
  assert.equal(stop.type, 'agent_completed')
  assert.equal(stop.agentId, 'sub-abc')
  assert.equal(stop.result, 'task complete')
})

test('MCP tools update main agent and keep existing MCP animation', () => {
  const startEvents = normalizeCodexHook({
    hook_event_name: 'PreToolUse',
    tool_name: 'mcp__github__search_code',
  })
  assert.equal(startEvents.length, 2)
  assert.equal(startEvents[0].type, 'agent_working')
  assert.equal(startEvents[0].agentId, PRIMARY_ASSISTANT_ID)
  assert.equal(startEvents[1].type, 'mcp_call')
  assert.equal(startEvents[1].server, 'github')
  assert.equal(startEvents[1].tool, 'search_code')

  const endEvents = normalizeCodexHook({
    hook_event_name: 'PostToolUse',
    tool_name: 'mcp__github__search_code',
  })
  assert.equal(endEvents[1].type, 'mcp_done')
})

test('permission request without agent_id updates main assistant', () => {
  const [event] = normalizeCodexHook({
    hook_event_name: 'PermissionRequest',
    tool_name: 'exec_command',
  })
  assert.equal(event.type, 'agent_working')
  assert.equal(event.agentId, PRIMARY_ASSISTANT_ID)
  assert.match(event.status, /waiting for approval/)
})

test('unknown or incomplete payloads never create phantom subagents', () => {
  assert.deepEqual(normalizeCodexHook(null), [])
  assert.deepEqual(normalizeCodexHook({ hook_event_name: 'FutureEvent' }), [])
  assert.deepEqual(normalizeCodexHook({ hook_event_name: 'SubagentStart' }), [])
  assert.deepEqual(normalizeCodexHook({ hook_event_name: 'SubagentStop' }), [])
})
