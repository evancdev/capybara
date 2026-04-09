import {
  createSdkMcpServer,
  tool
} from '@anthropic-ai/claude-agent-sdk'
import type { McpSdkServerConfigWithInstance } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import type { InterAgentRouter } from '@/main/services/inter-agent-router'
import type { AgentDirectoryEntry } from '@/shared/types/session'

/** Logical tool name the model invokes (before MCP server prefixing). */
export const SEND_TO_AGENT_TOOL_NAME = 'send_to_agent'
export const REGISTER_AGENT_TOOL_NAME = 'register_agent'
export const LIST_AGENTS_TOOL_NAME = 'list_agents'

/** Name of the in-process MCP server that hosts inter-agent tooling. */
export const INTER_AGENT_MCP_SERVER_NAME = 'capybara_inter_agent'

/**
 * Narrow directory surface the MCP layer depends on. Decouples the tool
 * factory from the full SessionService so tests can substitute a fake.
 * Implementations: both methods are synchronous and must not throw for
 * reads — errors inside `registerRole` surface as MCP tool errors.
 */
export interface InterAgentDirectory {
  registerRole(
    sessionId: string,
    role: string
  ): {
    ok: true
    role: string
    animal: string
    displayName: string
    previousRole: string | null
  }
  getAgentDirectory(): AgentDirectoryEntry[]
}

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

const REGISTER_AGENT_DESCRIPTION = [
  'Register your agent identity so peer agents can discover you via list_agents.',
  'Call this tool once per session, ideally as your first action, passing your role',
  'as a short string. Idempotent — calling again overwrites the previous role but',
  'keeps the same animal identity.',
  '',
  'USE THIS TOOL WHEN:',
  '- You are starting a new session and the system asks you to register.',
  '- You want to update your declared role mid-session.',
  '',
  'INPUT:',
  '- role: A short lowercase string describing your role (e.g. "backend-engineer", "frontend-developer", "product-manager", "qa-tester", "software-architect", "researcher"). 1-64 characters. Free-form but use kebab-case for consistency.',
  '',
  'RESPONSE: {ok: true, role, animal, displayName, previousRole}',
  'The system auto-assigns you a unique animal identity. Your display name',
  'will be "{role} the {animal}" (e.g., "backend-engineer the Otter").',
  'This name is used when you communicate with other agents.'
].join('\n')

const LIST_AGENTS_DESCRIPTION = [
  'List all live agent sessions in Capybara across all projects. Use this to',
  'discover peer agents before calling send_to_agent.',
  '',
  'USE THIS TOOL WHEN:',
  '- You need to find another agent to collaborate with.',
  '- The user asks you to delegate to or consult with another agent.',
  '- You want to see who\'s currently running.',
  '',
  'INPUT: None.',
  '',
  'RESPONSE: {agents: [{id, role, animal, displayName, name, cwd, gitRoot, gitBranch, status, createdAt}, ...]}',
  'Includes your own session. role/animal/displayName/name may be null if an agent',
  'has not registered. displayName is "{role} the {animal}" when both are set.',
  'cwd is the session\'s working directory. gitRoot and gitBranch are the git',
  'worktree info at session creation time (may be null if the cwd is not a git repo).',
  'Status is \'running\' or \'exited\'.'
].join('\n')

/**
 * Build an in-process MCP server exposing inter-agent tools for a single
 * session. Three tools live here:
 *
 *   - `send_to_agent`   — block-and-await RPC to a peer session
 *   - `register_agent`  — declare this session's role (idempotent)
 *   - `list_agents`     — discovery across all live sessions (includes self)
 *
 * The handler closes over `fromSessionId` because the SDK's tool-handler
 * `extra` argument does not carry caller identity — we need one server
 * instance per session so the router + directory know who is calling.
 *
 * `directory` is a narrow interface (not the full SessionService) so this
 * layer stays testable and the MCP surface cannot accidentally touch session
 * internals like connections or history.
 */
export function buildInterAgentMcpServer(
  fromSessionId: string,
  router: InterAgentRouter,
  directory: InterAgentDirectory
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
      ),
      tool(
        REGISTER_AGENT_TOOL_NAME,
        REGISTER_AGENT_DESCRIPTION,
        {
          role: z
            .string()
            .min(1)
            .max(64)
            .describe('Your role as a short kebab-case string')
        },
        (args) => {
          try {
            const result = directory.registerRole(
              fromSessionId,
              args.role.trim()
            )
            return Promise.resolve({
              content: [{ type: 'text', text: JSON.stringify(result) }]
            })
          } catch (err) {
            const message =
              err instanceof Error ? err.message : String(err)
            return Promise.resolve({
              isError: true,
              content: [{ type: 'text', text: message }]
            })
          }
        }
      ),
      tool(
        LIST_AGENTS_TOOL_NAME,
        LIST_AGENTS_DESCRIPTION,
        {},
        () => {
          try {
            const agents = directory.getAgentDirectory()
            return Promise.resolve({
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ agents }, null, 2)
                }
              ]
            })
          } catch (err) {
            const message =
              err instanceof Error ? err.message : String(err)
            return Promise.resolve({
              isError: true,
              content: [{ type: 'text', text: message }]
            })
          }
        }
      )
    ]
  })
}
