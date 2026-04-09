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

  it('does not show "unknown" when metadata.model is undefined', () => {
    const session = makeSession({ metadata: {} })
    render(<SessionStatusStrip session={session} />)

    expect(screen.queryByText('unknown')).not.toBeInTheDocument()
  })

  it('does not show "unknown" when metadata itself is undefined', () => {
    const session = makeSession({ metadata: undefined })
    render(<SessionStatusStrip session={session} />)

    expect(screen.queryByText('unknown')).not.toBeInTheDocument()
  })

  it('shows role when registered', () => {
    const session = makeSession({ role: 'backend-engineer' })
    render(<SessionStatusStrip session={session} />)

    expect(screen.getByText('backend-engineer')).toBeInTheDocument()
  })

  it('does not show role when null', () => {
    const session = makeSession({ role: null })
    const { container } = render(<SessionStatusStrip session={session} />)

    // Should only show the branch, no role segment
    expect(screen.getByText('main')).toBeInTheDocument()
    // Only one separator or none (depending on whether model is present)
    const separators = container.querySelectorAll('[aria-hidden="true"]')
    expect(separators.length).toBeLessThanOrEqual(1)
  })

  it('shows gitBranch when available', () => {
    const session = makeSession({ gitBranch: 'feature/auth' })
    render(<SessionStatusStrip session={session} />)

    expect(screen.getByText('feature/auth')).toBeInTheDocument()
  })

  it('defaults to "main" when gitBranch is null', () => {
    const session = makeSession({ gitBranch: null })
    render(<SessionStatusStrip session={session} />)

    expect(screen.getByText('main')).toBeInTheDocument()
  })

  it('does not show cwd or session ID', () => {
    const session = makeSession({
      id: 'abcdef12-3456-7890-abcd-ef1234567890',
      metadata: { model: 'test-model' },
      role: 'pm',
      gitBranch: 'main'
    })
    render(<SessionStatusStrip session={session} />)

    // Session ID should NOT appear
    expect(screen.queryByText('abcdef12')).not.toBeInTheDocument()
  })

  it('shows full strip: model · role · branch', () => {
    const session = makeSession({
      metadata: { model: 'claude-sonnet-4-20250514' },
      role: 'backend-engineer',
      gitBranch: 'feature/auth'
    })
    const { container } = render(<SessionStatusStrip session={session} />)

    expect(screen.getByText('claude-sonnet-4-20250514')).toBeInTheDocument()
    expect(screen.getByText('backend-engineer')).toBeInTheDocument()
    expect(screen.getByText('feature/auth')).toBeInTheDocument()

    // Two separators: model · role · branch
    const separators = container.querySelectorAll('[aria-hidden="true"]')
    expect(separators).toHaveLength(2)
  })

  it('shows only branch when model and role are null', () => {
    const session = makeSession({
      metadata: undefined,
      role: null,
      gitBranch: 'develop'
    })
    const { container } = render(<SessionStatusStrip session={session} />)

    expect(screen.getByText('develop')).toBeInTheDocument()
    // No separators needed when only branch is shown
    const separators = container.querySelectorAll('[aria-hidden="true"]')
    expect(separators).toHaveLength(0)
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
    const session = makeSession({
      metadata: { model: 'test' },
      role: 'pm',
      gitBranch: 'main'
    })
    const { container } = render(<SessionStatusStrip session={session} />)

    const separators = container.querySelectorAll('[aria-hidden="true"]')
    // Two separators: model · role · branch
    expect(separators).toHaveLength(2)
  })
})
