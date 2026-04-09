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

  it('renders exactly three radio buttons', () => {
    render(<ModeSelector {...defaultProps} />)
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(3)
  })

  it('each radio button has type="button" to prevent form submission', () => {
    render(<ModeSelector {...defaultProps} />)
    const radios = screen.getAllByRole('radio')
    for (const radio of radios) {
      expect(radio).toHaveAttribute('type', 'button')
    }
  })

  it('has title hint mentioning Shift+Tab', () => {
    render(<ModeSelector {...defaultProps} />)
    const group = screen.getByRole('radiogroup')
    expect(group).toHaveAttribute('title', expect.stringContaining('Shift+Tab'))
  })

  it('when currentMode is bypassPermissions, no radio is checked (BUG: no radio should be unchecked in a radiogroup)', () => {
    // This test documents the current behavior — when the mode is outside
    // CYCLING_PERMISSION_MODES, no segment is active. This is arguably a
    // bug since ARIA radiogroups should always have one checked radio.
    render(<ModeSelector {...defaultProps} currentMode="bypassPermissions" />)
    const radios = screen.getAllByRole('radio')
    const anyChecked = radios.some(
      (r) => r.getAttribute('aria-checked') === 'true'
    )
    expect(anyChecked).toBe(false)
  })

  it('when currentMode is dontAsk, no radio is checked', () => {
    render(<ModeSelector {...defaultProps} currentMode="dontAsk" />)
    const radios = screen.getAllByRole('radio')
    const anyChecked = radios.some(
      (r) => r.getAttribute('aria-checked') === 'true'
    )
    expect(anyChecked).toBe(false)
  })

  it('shows sr-only status element for non-cycling mode (bypassPermissions)', () => {
    render(<ModeSelector {...defaultProps} currentMode="bypassPermissions" />)
    const status = screen.getByRole('status')
    expect(status).toBeInTheDocument()
    expect(status.textContent).toContain('bypass')
  })

  it('does not show sr-only status element for cycling mode (default)', () => {
    render(<ModeSelector {...defaultProps} currentMode="default" />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('radiogroup aria-label includes current mode name for non-cycling modes', () => {
    render(<ModeSelector {...defaultProps} currentMode="bypassPermissions" />)
    const group = screen.getByRole('radiogroup')
    expect(group.getAttribute('aria-label')).toContain('current:')
  })

  it('radiogroup aria-label is simple for cycling modes', () => {
    render(<ModeSelector {...defaultProps} currentMode="default" />)
    const group = screen.getByRole('radiogroup')
    expect(group.getAttribute('aria-label')).toBe('Permission mode')
  })
})
