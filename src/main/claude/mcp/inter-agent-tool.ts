import {
  createSdkMcpServer,
  tool
} from '@anthropic-ai/claude-agent-sdk'
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { InterAgentRouter } from '@/main/services/inter-agent-router'

/** Logical tool name the model invokes (before MCP server prefixing). */
export const SEND_TO_AGENT_TOOL_NAME = 'send_to_agent'

/** Name of the in-process MCP server that hosts inter-agent tooling. */
export const INTER_AGENT_MCP_SERVER_NAME = 'capybara_inter_agent'

/**
 * Model-visible tool description. Covers, in order:
 *   1. One-line summary
 *   2. USE THIS TOOL WHEN
 *   3. DO NOT USE THIS TOOL WHEN
 *   4. Input semantics
 *   5. Response semantics
 *   6. Error enumeration
 */
const SEND_TO_AGENT_DESCRIPTION = [
  'Send a message to another Capybara agent session and receive its next assistant reply as your tool result.',
  '',
  'USE THIS TOOL WHEN:',
  '- You need information, analysis, or a decision from a peer agent running in a different session (potentially with a different working directory, role, or context).',
  '- You want to delegate a focused sub-task to another agent and block on its answer before continuing your own turn.',
  '- The user has told you that another session has domain expertise or state you lack.',
  '',
  'DO NOT USE THIS TOOL WHEN:',
  '- You can answer the question yourself from your own context or tools.',
  '- You only need to notify the user (talk to them directly instead).',
  '- You want to broadcast — this tool is 1:1, not fan-out.',
  '- You are already inside a deep chain of inter-agent calls (the system enforces a max hop limit and will reject further nesting).',
  '',
  'INPUT SEMANTICS:',
  '- `to` is the UUID of the target session. The target agent has an ISOLATED conversation context: it does NOT see your conversation history, your tool results, or the user prompt you are responding to.',
  '- `content` must be a self-contained message. Include any background, constraints, and the precise question you want answered. Do not rely on shared context — there is none.',
  '',
  'RESPONSE SEMANTICS:',
  '- This call BLOCKS until the target agent produces its next assistant reply. The returned text is the literal text of that reply.',
  '- If the target is currently mid-turn, your message is queued and delivered at the next turn boundary. Expect latency.',
  '- Only text-bearing replies resolve the call; tool-only turns by the target are skipped.',
  '',
  'ERRORS (returned as tool errors — do NOT retry blindly):',
  '- "Session not found" — the `to` UUID does not match any live session.',
  '- "Circular inter-agent call detected" — this call would form a cycle with an already in-flight inter-agent call.',
  '- "Max inter-agent hops exceeded" — the call chain is too deep; stop delegating.',
  '- "Target session exited before replying" — the target was destroyed or crashed while you were waiting.',
  '- "inter-agent call timed out" — the target did not reply within the timeout window.'
].join('\n')

/**
 * Build an in-process MCP server exposing the `send_to_agent` tool for a
 * single session. The handler closes over `fromSessionId` because the SDK's
 * tool-handler `extra` argument does not carry caller identity — we need one
 * server instance per session so the router knows who is calling.
 */
export function buildInterAgentMcpServer(
  fromSessionId: string,
  router: InterAgentRouter
): McpSdkServerConfigWithInstance {
  return createSdkMcpServer({
    name: INTER_AGENT_MCP_SERVER_NAME,
    version: '1.0.0',
    tools: [
      tool(
        SEND_TO_AGENT_TOOL_NAME,
        SEND_TO_AGENT_DESCRIPTION,
        {
          to: z
            .uuid()
            .describe(
              'Target session ID (UUID) of the agent you want to message.'
            ),
          content: z
            .string()
            .min(1)
            .max(16_000)
            .describe('The message body to deliver to the target agent.')
        },
        async (args) => {
          try {
            const reply = await router.handleToolCall(fromSessionId, args)
            return { content: [{ type: 'text', text: reply }] }
          } catch (err) {
            const message =
              err instanceof Error ? err.message : String(err)
            return {
              isError: true,
              content: [{ type: 'text', text: message }]
            }
          }
        }
      )
    ]
  })
}
