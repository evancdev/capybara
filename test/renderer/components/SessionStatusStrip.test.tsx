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
    ...overrides
  }
}

describe('SessionStatusStrip', () => {
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
})
