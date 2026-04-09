import { describe, it, expect } from 'vitest'
import type {
  HookInput,
  SessionStartHookInput
} from '@anthropic-ai/claude-agent-sdk'
import { buildRegisterAgentHook } from '@/main/hooks/register-agent-hook'

// ---------------------------------------------------------------------------
// buildRegisterAgentHook(sessionId) returns a hooks descriptor that:
//   1. Has a `SessionStart` key whose value is an array of HookCallbackMatcher
//      objects (each with a `hooks` array of callbacks).
//   2. On the `startup` source, the callback returns a
//      `hookSpecificOutput.initialUserMessage` string that mentions
//      `register_agent` and the Capybara system.
//   3. On the `resume`, `compact`, and `clear` sources (the other members of
//      SessionStartHookInput['source']), the callback is a no-op — it returns
//      either an empty object or one without `hookSpecificOutput`, so the SDK
//      does NOT re-prompt the agent to re-register on every resume.
//
// We construct a minimal fake SessionStartHookInput (all the required
// BaseHookInput fields plus source + hook_event_name) and invoke the captured
// callback directly. No SDK server needed.
// ---------------------------------------------------------------------------

const SESSION_ID = 'sid-under-test'

function makeSessionStartInput(
  source: SessionStartHookInput['source']
): SessionStartHookInput {
  return {
    session_id: SESSION_ID,
    transcript_path: '/tmp/transcript.jsonl',
    cwd: '/Users/test/project',
    hook_event_name: 'SessionStart',
    source
  }
}

/** Extract the single SessionStart HookCallback from a built hook descriptor. */
function firstCallback(
  hook: ReturnType<typeof buildRegisterAgentHook>
): (
  input: HookInput,
  toolUseID: string | undefined,
  options: { signal: AbortSignal }
) => unknown {
  const matchers = hook?.SessionStart
  if (matchers === undefined || matchers.length === 0) {
    throw new Error('expected at least one SessionStart HookCallbackMatcher')
  }
  const firstMatcher = matchers[0]
  const cb = firstMatcher.hooks[0]
  if (cb === undefined) {
    throw new Error('expected at least one hook callback in the first matcher')
  }
  return cb
}

async function invokeCallback(
  hook: ReturnType<typeof buildRegisterAgentHook>,
  source: SessionStartHookInput['source']
): Promise<Record<string, unknown>> {
  const cb = firstCallback(hook)
  const result = await cb(
    makeSessionStartInput(source),
    undefined,
    { signal: new AbortController().signal }
  )
  return (result ?? {}) as Record<string, unknown>
}

describe('buildRegisterAgentHook', () => {
  // -------------------------------------------------------------------------
  // 1. Shape: returns { SessionStart: HookCallbackMatcher[] }
  // -------------------------------------------------------------------------
  it('returns a hooks object with a SessionStart key bound to a matcher array', () => {
    const hook = buildRegisterAgentHook(SESSION_ID)

    expect(hook).toBeDefined()
    expect(hook).toHaveProperty('SessionStart')

    const matchers = hook?.SessionStart
    expect(Array.isArray(matchers)).toBe(true)
    expect(matchers?.length).toBeGreaterThan(0)

    const first = matchers?.[0]
    expect(first).toBeDefined()
    expect(Array.isArray(first?.hooks)).toBe(true)
    expect(first?.hooks.length).toBeGreaterThan(0)
    expect(typeof first?.hooks[0]).toBe('function')
  })

  // -------------------------------------------------------------------------
  // 2. Happy path: startup source → initialUserMessage present
  // -------------------------------------------------------------------------
  it('emits an initialUserMessage mentioning register_agent and Capybara on source=startup', async () => {
    const hook = buildRegisterAgentHook(SESSION_ID)
    const result = await invokeCallback(hook, 'startup')

    expect(result).toHaveProperty('hookSpecificOutput')
    const specific = result.hookSpecificOutput as {
      hookEventName?: string
      initialUserMessage?: string
    }
    expect(specific.hookEventName).toBe('SessionStart')
    expect(typeof specific.initialUserMessage).toBe('string')
    expect(specific.initialUserMessage).toContain('register_agent')
    // Loose match for "Capybara" identity (case-insensitive so the backend
    // can phrase it however it wants).
    expect(specific.initialUserMessage ?? '').toMatch(/capybara/i)
  })

  // -------------------------------------------------------------------------
  // 3. No-op on resume
  // -------------------------------------------------------------------------
  it('is a no-op on source=resume (no hookSpecificOutput / no initialUserMessage)', async () => {
    const hook = buildRegisterAgentHook(SESSION_ID)
    const result = await invokeCallback(hook, 'resume')

    // Accept either empty object or an object without hookSpecificOutput.
    const specific = (result as { hookSpecificOutput?: unknown })
      .hookSpecificOutput
    expect(specific).toBeUndefined()
  })

  // -------------------------------------------------------------------------
  // 4. No-op on compact
  // -------------------------------------------------------------------------
  it('is a no-op on source=compact', async () => {
    const hook = buildRegisterAgentHook(SESSION_ID)
    const result = await invokeCallback(hook, 'compact')

    const specific = (result as { hookSpecificOutput?: unknown })
      .hookSpecificOutput
    expect(specific).toBeUndefined()
  })

  // -------------------------------------------------------------------------
  // 5. No-op on clear (valid per SessionStartHookInput['source'] union)
  // -------------------------------------------------------------------------
  it('is a no-op on source=clear', async () => {
    const hook = buildRegisterAgentHook(SESSION_ID)
    const result = await invokeCallback(hook, 'clear')

    const specific = (result as { hookSpecificOutput?: unknown })
      .hookSpecificOutput
    expect(specific).toBeUndefined()
  })
})
