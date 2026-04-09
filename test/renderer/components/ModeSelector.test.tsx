import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

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

  beforeEach(() => {
    setSessionPermissionModeMock.mockClear()
  })

  it('shows only the current mode label when collapsed', () => {
    render(<ModeSelector {...defaultProps} />)
    expect(screen.getByText('approve')).toBeInTheDocument()
    expect(screen.queryByText('plan')).not.toBeInTheDocument()
    expect(screen.queryByText('auto')).not.toBeInTheDocument()
  })

  it('shows "plan" label when currentMode is plan', () => {
    render(<ModeSelector {...defaultProps} currentMode="plan" />)
    expect(screen.getByText('plan')).toBeInTheDocument()
    expect(screen.queryByText('approve')).not.toBeInTheDocument()
  })

  it('shows "auto" label when currentMode is acceptEdits', () => {
    render(<ModeSelector {...defaultProps} currentMode="acceptEdits" />)
    expect(screen.getByText('auto')).toBeInTheDocument()
    expect(screen.queryByText('approve')).not.toBeInTheDocument()
  })

  it('opens dropdown with all 3 modes on click', () => {
    render(<ModeSelector {...defaultProps} />)
    fireEvent.click(screen.getByRole('button'))
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(3)
    expect(options.map((o) => o.textContent)).toEqual([
      'approve',
      'plan',
      'auto'
    ])
  })

  it('marks the active mode with aria-selected', () => {
    render(<ModeSelector {...defaultProps} currentMode="plan" />)
    fireEvent.click(screen.getByRole('button'))
    const options = screen.getAllByRole('option')
    const planOption = options.find((o) => o.textContent === 'plan')
    expect(planOption).toHaveAttribute('aria-selected', 'true')
    const approveOption = options.find((o) => o.textContent === 'approve')
    expect(approveOption).toHaveAttribute('aria-selected', 'false')
  })

  it('calls setSessionPermissionMode and closes when clicking a different mode', () => {
    render(<ModeSelector {...defaultProps} currentMode="default" />)
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByText('plan'))
    expect(setSessionPermissionModeMock).toHaveBeenCalledWith(
      'test-session-1',
      'plan'
    )
    // Dropdown should be closed
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('closes without IPC call when clicking the active mode', () => {
    render(<ModeSelector {...defaultProps} currentMode="default" />)
    fireEvent.click(screen.getByRole('button'))
    const options = screen.getAllByRole('option')
    const approveOption = options.find((o) => o.textContent === 'approve')!
    fireEvent.click(approveOption)
    expect(setSessionPermissionModeMock).not.toHaveBeenCalled()
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('closes the dropdown on Escape', () => {
    render(<ModeSelector {...defaultProps} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('closes the dropdown on click outside', () => {
    render(<ModeSelector {...defaultProps} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.mouseDown(document)
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('pill button has correct ARIA attributes', () => {
    render(<ModeSelector {...defaultProps} />)
    const btn = screen.getByRole('button')
    expect(btn).toHaveAttribute('aria-haspopup', 'listbox')
    expect(btn).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(btn)
    expect(btn).toHaveAttribute('aria-expanded', 'true')
  })

  it('dropdown has listbox role with accessible label', () => {
    render(<ModeSelector {...defaultProps} />)
    fireEvent.click(screen.getByRole('button'))
    const listbox = screen.getByRole('listbox')
    expect(listbox).toHaveAttribute('aria-label', 'Permission mode')
  })

  it('calls setSessionPermissionMode with acceptEdits when clicking auto', () => {
    render(<ModeSelector {...defaultProps} currentMode="default" />)
    fireEvent.click(screen.getByRole('button'))
    fireEvent.click(screen.getByText('auto'))
    expect(setSessionPermissionModeMock).toHaveBeenCalledWith(
      'test-session-1',
      'acceptEdits'
    )
  })

  it('has title hint mentioning Shift+Tab', () => {
    render(<ModeSelector {...defaultProps} />)
    const container = screen.getByRole('button').parentElement
    expect(container).toHaveAttribute(
      'title',
      expect.stringContaining('Shift+Tab')
    )
  })
})
