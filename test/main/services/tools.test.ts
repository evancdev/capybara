import { describe, it, expect, vi } from 'vitest'

const mockLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
vi.mock('@/main/lib/logger', () => ({ logger: mockLogger }))

const { isToolAutoApproved, evaluateToolPolicy, ApprovalAbortedError } =
  await import('@/main/services/tools')
const { BaseError } = await import('@/main/lib/errors')

// ---------------------------------------------------------------------------
// isToolAutoApproved
// ---------------------------------------------------------------------------
describe('isToolAutoApproved', () => {
  it.each(['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch', 'AskUserQuestion'])(
    'returns true for auto-approved tool "%s"',
    (toolName) => {
      expect(isToolAutoApproved(toolName)).toBe(true)
    }
  )

  it.each(['Bash', 'Write', 'Edit', 'NotebookEdit', 'Agent', 'TodoWrite'])(
    'returns false for non-approved tool "%s"',
    (toolName) => {
      expect(isToolAutoApproved(toolName)).toBe(false)
    }
  )

  it('returns false for empty string', () => {
    expect(isToolAutoApproved('')).toBe(false)
  })

  it('is case-sensitive — "read" is not approved', () => {
    expect(isToolAutoApproved('read')).toBe(false)
    expect(isToolAutoApproved('READ')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// evaluateToolPolicy
// ---------------------------------------------------------------------------
describe('evaluateToolPolicy', () => {
  it('returns { behavior: "allow" } for auto-approved tools', () => {
    const result = evaluateToolPolicy('Read', {})
    expect(result).toEqual({ behavior: 'allow' })
  })

  it('returns { behavior: "ask_user" } for non-approved tools', () => {
    const result = evaluateToolPolicy('Bash', { command: 'rm -rf /' })
    expect(result).toEqual({ behavior: 'ask_user' })
  })

  it('logs "Tool auto-approved" for approved tools', () => {
    mockLogger.info.mockClear()
    evaluateToolPolicy('Glob', {})
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Tool auto-approved',
      expect.objectContaining({ toolName: 'Glob' })
    )
  })

  it('logs "Tool requires user approval" for non-approved tools', () => {
    mockLogger.info.mockClear()
    evaluateToolPolicy('Write', {})
    expect(mockLogger.info).toHaveBeenCalledWith(
      'Tool requires user approval, forwarding to UI',
      expect.objectContaining({ toolName: 'Write' })
    )
  })

  it('ignores the input parameter — result depends only on tool name', () => {
    const a = evaluateToolPolicy('Read', { dangerous: true })
    const b = evaluateToolPolicy('Read', {})
    expect(a).toEqual(b)
  })
})

// ---------------------------------------------------------------------------
// ApprovalAbortedError
// ---------------------------------------------------------------------------
describe('ApprovalAbortedError', () => {
  it('has default message "Tool approval aborted"', () => {
    const err = new ApprovalAbortedError()
    expect(err.message).toBe('Tool approval aborted')
  })

  it('accepts a custom message', () => {
    const err = new ApprovalAbortedError('custom reason')
    expect(err.message).toBe('custom reason')
  })

  it('exposes publicMessage "Tool approval aborted"', () => {
    const err = new ApprovalAbortedError()
    expect(err.publicMessage).toBe('Tool approval aborted')
  })

  it('sets name to ApprovalAbortedError', () => {
    const err = new ApprovalAbortedError()
    expect(err.name).toBe('ApprovalAbortedError')
  })

  it('is an instance of BaseError and Error', () => {
    const err = new ApprovalAbortedError()
    expect(err).toBeInstanceOf(BaseError)
    expect(err).toBeInstanceOf(Error)
  })
})
