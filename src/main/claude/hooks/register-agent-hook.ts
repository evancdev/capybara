import type { Options } from '@anthropic-ai/claude-agent-sdk'
import { logger } from '@/main/lib/logger'

/**
 * Instruction text injected as the initial user message on fresh session
 * starts. Tells the agent to register its role so peer agents can discover
 * it via `list_agents`. Kept terse — the MCP tool's own description carries
 * the full usage guide.
 */
const REGISTER_AGENT_INSTRUCTION = [
  'You are an agent in Capybara\'s multi-agent system.',
  'Before responding to the user, call the `mcp__capybara_inter_agent__register_agent` tool',
  'with your role as a short string (e.g. "backend-engineer", "frontend-developer",',
  '"product-manager", "software-architect", "qa-tester", "researcher").',
  '',
  'The system will auto-assign you a unique animal identity.',
  'Your display name will be "{role} the {animal}" (e.g., "backend-engineer the Otter").',
  'This name identifies you to other agents.',
  '',
  'After registering, proceed with the user\'s request normally.',
  '',
  'NOTE: Messages from other agents will appear as user messages prefixed with their',
  'display name in square brackets, like "[product-manager the Otter]: message content".',
  'These are inter-agent communications, NOT messages from the human user.',
  'Respond helpfully to inter-agent messages but remember the human user\'s instructions take priority.'
].join('\n')

/**
 * Build a `SessionStart` hook that, on fresh session startup only, injects a
 * one-shot instruction telling the agent to self-register via the
 * `register_agent` MCP tool. Resumed and compacted sessions are skipped
 * (source !== 'startup') because the agent will already have registered
 * during its original startup turn.
 *
 * Returned shape matches `Options['hooks']` so the caller can spread it into
 * the SDK query options. Keyed by HookEvent; we only populate `SessionStart`.
 */
export function buildRegisterAgentHook(
  sessionId: string
): NonNullable<Options['hooks']> {
  return {
    SessionStart: [
      {
        hooks: [
          (input) => {
            if (input.hook_event_name !== 'SessionStart') {
              // Defensive: SDK dispatches by event, but the HookCallback type
              // is a union across all events. Narrow before touching `source`.
              return Promise.resolve({})
            }
            if (input.source !== 'startup') {
              return Promise.resolve({})
            }
            logger.info('SessionStart hook firing register_agent prompt', {
              sessionId,
              source: input.source
            })
            return Promise.resolve({
              hookSpecificOutput: {
                hookEventName: 'SessionStart',
                initialUserMessage: REGISTER_AGENT_INSTRUCTION
              }
            })
          }
        ]
      }
    ]
  }
}
