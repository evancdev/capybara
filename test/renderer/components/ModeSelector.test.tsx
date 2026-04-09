import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

const setSessionPermissionModeMock = vi.fn()

vi.mock('@/renderer/context/SessionContext', () => ({
  useSession: () => ({
    setSessionPermissionMode: setSessionPermissionModeMock
  })
}))

import { ModeSelector } from '@/renderer/components/ModeSelector'
import type { PermissionMode } from '@/shared/types/session'

describe('ModeSelector', () => {
  const defaultProps = {
    sessionId: 'test-session-1',
    currentMode: 'default' as PermissionMode
  }

  it('renders three segments with correct labels', () => {
    render(<ModeSelector {...defaultProps} />)
    expect(screen.getByText('approve')).toBeInTheDocument()
    expect(screen.getByText('plan')).toBeInTheDocument()
    expect(screen.getByText('auto')).toBeInTheDocument()
  })

  it('has a radiogroup role with accessible label', () => {
    render(<ModeSelector {...defaultProps} />)
    const group = screen.getByRole('radiogroup', { name: /permission mode/i })
    expect(group).toBeInTheDocument()
  })

  it('marks the active segment with aria-checked=true for default mode', () => {
    render(<ModeSelector {...defaultProps} currentMode="default" />)
    const radios = screen.getAllByRole('radio')
    const approveRadio = radios.find((r) => r.textContent === 'approve')
    expect(approveRadio).toHaveAttribute('aria-checked', 'true')
    const planRadio = radios.find((r) => r.textContent === 'plan')
    expect(planRadio).toHaveAttribute('aria-checked', 'false')
    const autoRadio = radios.find((r) => r.textContent === 'auto')
    expect(autoRadio).toHaveAttribute('aria-checked', 'false')
  })

  it('marks the active segment for plan mode', () => {
    render(<ModeSelector {...defaultProps} currentMode="plan" />)
    const radios = screen.getAllByRole('radio')
    const planRadio = radios.find((r) => r.textContent === 'plan')
    expect(planRadio).toHaveAttribute('aria-checked', 'true')
    const approveRadio = radios.find((r) => r.textContent === 'approve')
    expect(approveRadio).toHaveAttribute('aria-checked', 'false')
  })

  it('marks the active segment for auto (acceptEdits) mode', () => {
    render(<ModeSelector {...defaultProps} currentMode="acceptEdits" />)
    const radios = screen.getAllByRole('radio')
    const autoRadio = radios.find((r) => r.textContent === 'auto')
    expect(autoRadio).toHaveAttribute('aria-checked', 'true')
  })

  it('calls setSessionPermissionMode when clicking an inactive segment', () => {
    render(<ModeSelector {...defaultProps} currentMode="default" />)
    const planButton = screen.getByText('plan')
    planButton.click()
    expect(setSessionPermissionModeMock).toHaveBeenCalledWith(
      'test-session-1',
      'plan'
    )
  })

  it('does NOT call setSessionPermissionMode when clicking the active segment', () => {
    render(<ModeSelector {...defaultProps} currentMode="default" />)
    const approveButton = screen.getByText('approve')
    approveButton.click()
    expect(setSessionPermissionModeMock).not.toHaveBeenCalled()
  })

  it('calls setSessionPermissionMode with acceptEdits when clicking auto', () => {
    render(<ModeSelector {...defaultProps} currentMode="default" />)
    const autoButton = screen.getByText('auto')
    autoButton.click()
    expect(setSessionPermissionModeMock).toHaveBeenCalledWith(
      'test-session-1',
      'acceptEdits'
    )
  })
})
