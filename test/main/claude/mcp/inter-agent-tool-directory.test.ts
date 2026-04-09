import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'
import type { InterAgentRouter } from '@/main/services/inter-agent-router'
import type {
  InterAgentDirectory
} from '@/main/claude/mcp/inter-agent-tool'
import type { AgentDirectoryEntry } from '@/shared/types/session'

// ---------------------------------------------------------------------------
// Mock the SDK so we can capture tool definitions and invoke handlers directly.
// Mirrors the pattern used by `inter-agent-tool.test.ts`.
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

const { buildInterAgentMcpServer } = await import(
  '@/main/claude/mcp/inter-agent-tool'
)

const FROM_A = '11111111-1111-4111-8111-111111111111'
const FROM_B = '22222222-2222-4222-8222-222222222222'

function createFakeRouter(): InterAgentRouter {
  return {
    handleToolCall: vi.fn()
  } as unknown as InterAgentRouter
}

interface FakeDirectoryHandles {
  directory: InterAgentDirectory
  registerRole: ReturnType<typeof vi.fn>
  getAgentDirectory: ReturnType<typeof vi.fn>
}

function createFakeDirectory(): FakeDirectoryHandles {
  const registerRole = vi.fn()
  const getAgentDirectory = vi.fn()
  const directory: InterAgentDirectory = {
    registerRole,
    getAgentDirectory
  }
  return { directory, registerRole, getAgentDirectory }
}

function findTool(serverIndex: number, name: string): CapturedTool {
  const server = capturedServers[serverIndex]
  const tools = server.tools ?? []
  const match = tools.find((t) => t.name === name)
  if (match === undefined) {
    throw new Error(
      `tool ${name} not found at server index ${String(serverIndex)}`
    )
  }
  return match
}

describe('buildInterAgentMcpServer — register_agent + list_agents', () => {
  beforeEach(() => {
    capturedServers.length = 0
  })

  // -------------------------------------------------------------------------
  // 1. Shape: all three tools are exposed on one server instance.
  // -------------------------------------------------------------------------
  it('exposes send_to_agent, register_agent, and list_agents on the server', () => {
    const router = createFakeRouter()
    const { directory } = createFakeDirectory()

    buildInterAgentMcpServer(FROM_A, router, directory)

    expect(capturedServers).toHaveLength(1)
    const tools = capturedServers[0].tools ?? []
    const toolNames = tools.map((t) => t.name)
    expect(toolNames).toContain('send_to_agent')
    expect(toolNames).toContain('register_agent')
    expect(toolNames).toContain('list_agents')
  })

  // -------------------------------------------------------------------------
  // register_agent
  // -------------------------------------------------------------------------
  describe('register_agent handler', () => {
    it('returns a text block with the directory result on happy path', async () => {
      const router = createFakeRouter()
      const { directory, registerRole } = createFakeDirectory()
      registerRole.mockReturnValue({
        ok: true,
        role: 'backend-engineer',
        previousRole: null
      })

      buildInterAgentMcpServer(FROM_A, router, directory)
      const handler = findTool(0, 'register_agent').handler

      const result = await handler({ role: 'backend-engineer' }, {})

      expect(registerRole).toHaveBeenCalledWith(FROM_A, 'backend-engineer')
      expect(result.isError).toBeUndefined()
      expect(result.content).toHaveLength(1)
      expect(result.content[0].type).toBe('text')
      expect(result.content[0].text).toContain('"ok":true')
      expect(result.content[0].text).toContain('backend-engineer')
    })

    it('trims whitespace before passing to the directory', async () => {
      const router = createFakeRouter()
      const { directory, registerRole } = createFakeDirectory()
      registerRole.mockReturnValue({
        ok: true,
        role: 'backend-engineer',
        previousRole: null
      })

      buildInterAgentMcpServer(FROM_A, router, directory)
      const handler = findTool(0, 'register_agent').handler

      await handler({ role: '  backend-engineer  ' }, {})

      expect(registerRole).toHaveBeenCalledWith(FROM_A, 'backend-engineer')
    })

    it('returns isError:true with the error message when the directory throws', async () => {
      const router = createFakeRouter()
      const { directory, registerRole } = createFakeDirectory()
      registerRole.mockImplementation(() => {
        throw new Error('invalid role')
      })

      buildInterAgentMcpServer(FROM_A, router, directory)
      const handler = findTool(0, 'register_agent').handler

      const result = await handler({ role: 'something' }, {})

      expect(result.isError).toBe(true)
      expect(result.content).toHaveLength(1)
      expect(result.content[0]).toEqual({
        type: 'text',
        text: 'invalid role'
      })
    })

    describe('input schema', () => {
      it('accepts a valid non-empty role string', () => {
        const router = createFakeRouter()
        const { directory } = createFakeDirectory()
        buildInterAgentMcpServer(FROM_A, router, directory)
        const schema = z.object(findTool(0, 'register_agent').inputSchema)

        const parsed = schema.parse({ role: 'backend-engineer' })
        expect(parsed).toEqual({ role: 'backend-engineer' })
      })

      it('rejects an empty role', () => {
        const router = createFakeRouter()
        const { directory } = createFakeDirectory()
        buildInterAgentMcpServer(FROM_A, router, directory)
        const schema = z.object(findTool(0, 'register_agent').inputSchema)

        expect(() => schema.parse({ role: '' })).toThrow()
      })

      it('rejects a role longer than 64 characters', () => {
        const router = createFakeRouter()
        const { directory } = createFakeDirectory()
        buildInterAgentMcpServer(FROM_A, router, directory)
        const schema = z.object(findTool(0, 'register_agent').inputSchema)

        expect(() => schema.parse({ role: 'x'.repeat(65) })).toThrow()
      })

      it('rejects a missing role field', () => {
        const router = createFakeRouter()
        const { directory } = createFakeDirectory()
        buildInterAgentMcpServer(FROM_A, router, directory)
        const schema = z.object(findTool(0, 'register_agent').inputSchema)

        expect(() => schema.parse({})).toThrow()
      })

      it('rejects a non-string role', () => {
        const router = createFakeRouter()
        const { directory } = createFakeDirectory()
        buildInterAgentMcpServer(FROM_A, router, directory)
        const schema = z.object(findTool(0, 'register_agent').inputSchema)

        expect(() => schema.parse({ role: 42 })).toThrow()
        expect(() => schema.parse({ role: null })).toThrow()
        expect(() => schema.parse({ role: { nested: 'x' } })).toThrow()
      })
    })
  })

  // -------------------------------------------------------------------------
  // list_agents
  // -------------------------------------------------------------------------
  describe('list_agents handler', () => {
    const entryA: AgentDirectoryEntry = {
      id: FROM_A,
      role: 'backend-engineer',
      name: 'alpha',
      cwd: '/Users/test/project-a',
      gitRoot: '/Users/test/project-a',
      gitBranch: 'main',
      status: 'running',
      createdAt: 1_700_000_000_000
    }
    const entryB: AgentDirectoryEntry = {
      id: FROM_B,
      role: null,
      name: 'beta',
      cwd: '/Users/test/project-b',
      gitRoot: null,
      gitBranch: null,
      status: 'running',
      createdAt: 1_700_000_001_000
    }

    it('returns a text block whose JSON body contains all directory entries', async () => {
      const router = createFakeRouter()
      const { directory, getAgentDirectory } = createFakeDirectory()
      getAgentDirectory.mockReturnValue([entryA, entryB])

      buildInterAgentMcpServer(FROM_A, router, directory)
      const handler = findTool(0, 'list_agents').handler

      const result = await handler({}, {})

      expect(result.isError).toBeUndefined()
      expect(result.content).toHaveLength(1)
      expect(result.content[0].type).toBe('text')

      const parsed = JSON.parse(result.content[0].text) as {
        agents: AgentDirectoryEntry[]
      }
      expect(parsed.agents).toHaveLength(2)
      expect(parsed.agents).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: FROM_A }),
          expect.objectContaining({ id: FROM_B })
        ])
      )
    })

    it('includes the caller session in the returned list (does NOT filter self)', async () => {
      const router = createFakeRouter()
      const { directory, getAgentDirectory } = createFakeDirectory()
      getAgentDirectory.mockReturnValue([entryA])

      buildInterAgentMcpServer(FROM_A, router, directory)
      const handler = findTool(0, 'list_agents').handler

      const result = await handler({}, {})
      const parsed = JSON.parse(result.content[0].text) as {
        agents: AgentDirectoryEntry[]
      }
      expect(parsed.agents).toHaveLength(1)
      expect(parsed.agents[0].id).toBe(FROM_A)
    })

    it('returns { agents: [] } (not an error) when the directory is empty', async () => {
      const router = createFakeRouter()
      const { directory, getAgentDirectory } = createFakeDirectory()
      getAgentDirectory.mockReturnValue([])

      buildInterAgentMcpServer(FROM_A, router, directory)
      const handler = findTool(0, 'list_agents').handler

      const result = await handler({}, {})

      expect(result.isError).toBeUndefined()
      const parsed = JSON.parse(result.content[0].text) as {
        agents: AgentDirectoryEntry[]
      }
      expect(parsed.agents).toEqual([])
    })

    it('does not scope the directory by caller — two servers see identical data', async () => {
      const router = createFakeRouter()
      const { directory, getAgentDirectory } = createFakeDirectory()
      getAgentDirectory.mockReturnValue([entryA, entryB])

      buildInterAgentMcpServer(FROM_A, router, directory)
      buildInterAgentMcpServer(FROM_B, router, directory)

      const handlerForA = findTool(0, 'list_agents').handler
      const handlerForB = findTool(1, 'list_agents').handler

      const resultA = await handlerForA({}, {})
      const resultB = await handlerForB({}, {})

      const parsedA = JSON.parse(resultA.content[0].text) as {
        agents: AgentDirectoryEntry[]
      }
      const parsedB = JSON.parse(resultB.content[0].text) as {
        agents: AgentDirectoryEntry[]
      }

      expect(parsedA.agents).toHaveLength(2)
      expect(parsedB.agents).toHaveLength(2)
      expect(parsedA.agents.map((a) => a.id).sort()).toEqual(
        parsedB.agents.map((a) => a.id).sort()
      )
    })
  })
})
