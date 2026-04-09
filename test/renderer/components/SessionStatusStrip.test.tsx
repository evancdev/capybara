import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SessionStatusStrip } from '@/renderer/components/SessionStatusStrip'
import type { Session } from '@/shared/types/session'

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'abcdef1234567890',
    status: 'running',
    exitCode: null,
    createdAt: Date.now(),
    permissionMode: 'default',
    role: null,
    gitRoot: null,
    gitBranch: null,
    ...overrides
  }
}

describe('SessionStatusStrip', () => {
  it('renders nothing when session is undefined', () => {
    const { container } = render(
      <SessionStatusStrip session={undefined} />
    )
    expect(container.innerHTML).toBe('')
  })

  it('renders model from session metadata', () => {
    const session = makeSession({ metadata: { model: 'claude-sonnet-4-20250514' } })
    render(<SessionStatusStrip session={session} />)

    expect(screen.getByText('claude-sonnet-4-20250514')).toBeInTheDocument()
  })

  it('shows "unknown" when metadata.model is undefined', () => {
    const session = makeSession({ metadata: {} })
    render(<SessionStatusStrip session={session} />)

    expect(screen.getByText('unknown')).toBeInTheDocument()
  })

  it('shows "unknown" when metadata itself is undefined', () => {
    const session = makeSession({ metadata: undefined })
    render(<SessionStatusStrip session={session} />)

    expect(screen.getByText('unknown')).toBeInTheDocument()
  })

  it('shows truncated session ID (first 8 chars)', () => {
    const session = makeSession({ id: 'abcdef1234567890' })
    render(<SessionStatusStrip session={session} />)

    expect(screen.getByText('abcdef12')).toBeInTheDocument()
  })

  it('shows cwd when provided', () => {
    const session = makeSession({ metadata: { model: 'test-model' } })
    render(<SessionStatusStrip session={session} cwd="~/projects/capybara" />)

    expect(screen.getByText('~/projects/capybara')).toBeInTheDocument()
  })

  it('handles missing cwd gracefully', () => {
    const session = makeSession({ metadata: { model: 'test-model' } })
    const { container } = render(<SessionStatusStrip session={session} />)

    // Should render without the cwd segment — only 1 separator (before session ID)
    // instead of 2 (cwd separator + session ID separator)
    const separators = container.querySelectorAll('[aria-hidden="true"]')
    expect(separators).toHaveLength(1)
    expect(screen.getByText('test-model')).toBeInTheDocument()
  })

  it('handles empty string cwd gracefully', () => {
    const session = makeSession({ metadata: { model: 'test-model' } })
    const { container } = render(<SessionStatusStrip session={session} cwd="" />)

    const separators = container.querySelectorAll('[aria-hidden="true"]')
    expect(separators).toHaveLength(1)
  })

  it('has an accessible label', () => {
    const session = makeSession()
    render(<SessionStatusStrip session={session} />)

    expect(screen.getByLabelText('Session info')).toBeInTheDocument()
  })

  it('renders a very long model name without crashing', () => {
    const longModel = 'x'.repeat(500)
    const session = makeSession({ metadata: { model: longModel } })
    render(<SessionStatusStrip session={session} />)

    expect(screen.getByText(longModel)).toBeInTheDocument()
  })

  it('renders a very long cwd without crashing', () => {
    const longCwd = '/a/b/c/'.repeat(100)
    const session = makeSession({ metadata: { model: 'test-model' } })
    render(<SessionStatusStrip session={session} cwd={longCwd} />)

    expect(screen.getByText(longCwd)).toBeInTheDocument()
  })

  it('renders model with special characters', () => {
    const session = makeSession({
      metadata: { model: 'claude-opus-4-6@2026-04-08' }
    })
    render(<SessionStatusStrip session={session} />)

    expect(
      screen.getByText('claude-opus-4-6@2026-04-08')
    ).toBeInTheDocument()
  })

  it('uses aria-hidden on separator dots', () => {
    const session = makeSession({ metadata: { model: 'test' } })
    const { container } = render(
      <SessionStatusStrip session={session} cwd="/tmp" />
    )

    const separators = container.querySelectorAll('[aria-hidden="true"]')
    // Two separators: one before cwd, one before session ID
    expect(separators).toHaveLength(2)
  })

  it('truncates session ID to exactly 8 characters', () => {
    const session = makeSession({
      id: '12345678-1234-1234-1234-123456789012'
    })
    render(<SessionStatusStrip session={session} />)

    expect(screen.getByText('12345678')).toBeInTheDocument()
  })
})
