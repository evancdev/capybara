import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'
import type { InterAgentRouter } from '@/main/services/inter-agent-router'
import { CircularInterAgentCallError } from '@/main/lib/errors'

// ---------------------------------------------------------------------------
// Mock the SDK so we can capture what gets passed to `createSdkMcpServer` and
// `tool`, then invoke the captured handler directly. Exercising the handler
// through a live MCP server would require an RPC transport — we only care
// about the contract between our factory and the SDK primitives.
// ---------------------------------------------------------------------------
interface CapturedServerConfig {
  name: string
  version?: string
  tools?: CapturedTool[]
}
interface CapturedTool {
  name: string
  description: string
  inputSchema: Record<string, z.ZodType>
  handler: (
    args: Record<string, unknown>,
    extra: unknown
  ) => Promise<{
    content: { type: string; text: string }[]
    isError?: boolean
  }>
}

const capturedServers: CapturedServerConfig[] = []

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  createSdkMcpServer: (opts: CapturedServerConfig) => {
    capturedServers.push(opts)
    return {
      type: 'sdk' as const,
      name: opts.name,
      instance: {}
    }
  },
  tool: (
    name: string,
    description: string,
    inputSchema: Record<string, z.ZodType>,
    handler: CapturedTool['handler']
  ): CapturedTool => ({
    name,
    description,
    inputSchema,
    handler
  })
}))

// Import after the mock so the factory resolves to our stubs.
const {
  buildInterAgentMcpServer,
  SEND_TO_AGENT_TOOL_NAME,
  INTER_AGENT_MCP_SERVER_NAME
} = await import('@/main/claude/mcp/inter-agent-tool')

const FROM_A = '11111111-1111-4111-8111-111111111111'
const FROM_B = '22222222-2222-4222-8222-222222222222'
const TARGET = '33333333-3333-4333-8333-333333333333'

function createFakeRouter(): InterAgentRouter {
  return {
    handleToolCall: vi.fn()
  } as unknown as InterAgentRouter
}

function getCapturedTool(serverIndex: number): CapturedTool {
  const server = capturedServers[serverIndex]
  const tools = server.tools ?? []
  const first = tools[0]
  if (first === undefined) {
    throw new Error(`no tool captured at server index ${String(serverIndex)}`)
  }
  return first
}

describe('buildInterAgentMcpServer', () => {
  beforeEach(() => {
    capturedServers.length = 0
  })

  // -------------------------------------------------------------------------
  // 1. Tool definition shape (server name, tool name, description keywords).
  // -------------------------------------------------------------------------
  it('returns an SDK MCP server with the expected name, version, and single send_to_agent tool', () => {
    const router = createFakeRouter()
    const server = buildInterAgentMcpServer(FROM_A, router)

    expect(server).toMatchObject({
      type: 'sdk',
      name: INTER_AGENT_MCP_SERVER_NAME
    })

    expect(capturedServers).toHaveLength(1)
    expect(capturedServers[0].name).toBe(INTER_AGENT_MCP_SERVER_NAME)
    expect(capturedServers[0].version).toBe('1.0.0')
    expect(capturedServers[0].tools).toHaveLength(1)

    const captured = getCapturedTool(0)
    expect(captured.name).toBe(SEND_TO_AGENT_TOOL_NAME)
  })

  it('includes the USE/DO NOT USE/error keywords in the model-visible tool description', () => {
    const router = createFakeRouter()
    buildInterAgentMcpServer(FROM_A, router)
    const description = getCapturedTool(0).description

    expect(description).toContain('USE THIS TOOL WHEN')
    expect(description).toContain('DO NOT USE')
    expect(description).toMatch(/circular/i)
    expect(description).toMatch(/max/i)
    expect(description).toContain('exited')
  })

  // -------------------------------------------------------------------------
  // 2. Handler happy path — returns the CallToolResult shape without isError.
  // -------------------------------------------------------------------------
  it('handler resolves with { content: [{type:text, text:reply}] } on success', async () => {
    const router = createFakeRouter()
    ;(router.handleToolCall as ReturnType<typeof vi.fn>).mockResolvedValue(
      'reply text'
    )
    buildInterAgentMcpServer(FROM_A, router)
    const handler = getCapturedTool(0).handler

    const result = await handler(
      { to: TARGET, content: 'hi' },
      /* extra */ {}
    )

    expect(result).toEqual({
      content: [{ type: 'text', text: 'reply text' }]
    })
    expect(result.isError).toBeUndefined()
  })

  // -------------------------------------------------------------------------
  // 3. Handler error path — isError:true with the error message surfaced.
  // -------------------------------------------------------------------------
  it('handler returns isError:true with the error message when the router throws', async () => {
    const router = createFakeRouter()
    ;(router.handleToolCall as ReturnType<typeof vi.fn>).mockRejectedValue(
      new CircularInterAgentCallError(FROM_A, TARGET)
    )
    buildInterAgentMcpServer(FROM_A, router)
    const handler = getCapturedTool(0).handler

    const result = await handler({ to: TARGET, content: 'hi' }, {})

    expect(result.isError).toBe(true)
    expect(result.content).toHaveLength(1)
    expect(result.content[0].type).toBe('text')
    expect(result.content[0].text.toLowerCase()).toContain('circular')
  })

  // -------------------------------------------------------------------------
  // 4. Zod schema validation — the tool's inputSchema rejects bad inputs.
  // -------------------------------------------------------------------------
  describe('input schema', () => {
    it('accepts a valid UUID `to` and non-empty `content`', () => {
      const router = createFakeRouter()
      buildInterAgentMcpServer(FROM_A, router)
      const schema = z.object(getCapturedTool(0).inputSchema)

      const parsed = schema.parse({ to: TARGET, content: 'hello' })
      expect(parsed).toEqual({ to: TARGET, content: 'hello' })
    })

    it('rejects non-UUID `to`', () => {
      const router = createFakeRouter()
      buildInterAgentMcpServer(FROM_A, router)
      const schema = z.object(getCapturedTool(0).inputSchema)

      expect(() => schema.parse({ to: 'not-a-uuid', content: 'hi' })).toThrow()
    })

    it('rejects empty `content`', () => {
      const router = createFakeRouter()
      buildInterAgentMcpServer(FROM_A, router)
      const schema = z.object(getCapturedTool(0).inputSchema)

      expect(() => schema.parse({ to: TARGET, content: '' })).toThrow()
    })

    it('rejects `content` longer than 16000 characters', () => {
      const router = createFakeRouter()
      buildInterAgentMcpServer(FROM_A, router)
      const schema = z.object(getCapturedTool(0).inputSchema)

      expect(() =>
        schema.parse({ to: TARGET, content: 'x'.repeat(16_001) })
      ).toThrow()
    })

    it('rejects missing fields', () => {
      const router = createFakeRouter()
      buildInterAgentMcpServer(FROM_A, router)
      const schema = z.object(getCapturedTool(0).inputSchema)

      expect(() => schema.parse({ to: TARGET })).toThrow()
      expect(() => schema.parse({ content: 'hi' })).toThrow()
      expect(() => schema.parse({})).toThrow()
    })
  })

  // -------------------------------------------------------------------------
  // 5. Closure over fromSessionId — each server invokes router with its own.
  // -------------------------------------------------------------------------
  it('closes over fromSessionId so each built server forwards its own sender id', async () => {
    const router = createFakeRouter()
    const handleToolCall = router.handleToolCall as ReturnType<typeof vi.fn>
    handleToolCall.mockResolvedValue('ok')

    buildInterAgentMcpServer(FROM_A, router)
    buildInterAgentMcpServer(FROM_B, router)

    const handlerForA = getCapturedTool(0).handler
    const handlerForB = getCapturedTool(1).handler

    await handlerForA({ to: TARGET, content: 'msg from A' }, {})
    await handlerForB({ to: TARGET, content: 'msg from B' }, {})

    expect(handleToolCall).toHaveBeenNthCalledWith(1, FROM_A, {
      to: TARGET,
      content: 'msg from A'
    })
    expect(handleToolCall).toHaveBeenNthCalledWith(2, FROM_B, {
      to: TARGET,
      content: 'msg from B'
    })
  })
})
