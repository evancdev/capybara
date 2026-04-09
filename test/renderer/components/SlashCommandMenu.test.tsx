import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

import { SlashCommandMenu } from '@/renderer/components/SlashCommandMenu'
import { filterSlashCommands } from '@/renderer/lib/slash-filter'
import { SLASH_COMMANDS } from '@/shared/types/commands'

// ---------------------------------------------------------------------------
// filterSlashCommands (pure function)
// ---------------------------------------------------------------------------
describe('filterSlashCommands', () => {
  it('returns all commands when filter is empty', () => {
    const result = filterSlashCommands('')
    expect(result).toHaveLength(SLASH_COMMANDS.length)
  })

  it('filters by prefix "c" -> /compact (and any other c-prefixed)', () => {
    const result = filterSlashCommands('c')
    const names = result.map((c) => c.name)
    expect(names).toContain('compact')
  })

  it('filters by prefix "co" -> /compact', () => {
    const result = filterSlashCommands('co')
    const names = result.map((c) => c.name)
    expect(names).toContain('compact')
    // Shouldn't include commands that don't start with "co"
    expect(names.every((n) => n.startsWith('co'))).toBe(true)
  })

  it('filters by prefix "m" -> /model', () => {
    const result = filterSlashCommands('m')
    const names = result.map((c) => c.name)
    expect(names).toContain('model')
  })

  it('returns empty array for a filter that matches nothing', () => {
    const result = filterSlashCommands('zzzzz')
    expect(result).toHaveLength(0)
  })

  it('is case-insensitive', () => {
    const result = filterSlashCommands('M')
    const names = result.map((c) => c.name)
    expect(names).toContain('model')
  })
})

// ---------------------------------------------------------------------------
// SlashCommandMenu component
// ---------------------------------------------------------------------------
describe('SlashCommandMenu', () => {
  const defaultProps = {
    open: true,
    filter: '',
    selectedIndex: 0,
    onSelect: vi.fn(),
    onDismiss: vi.fn()
  }

  it('renders nothing when open is false', () => {
    const { container } = render(
      <SlashCommandMenu {...defaultProps} open={false} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders all commands with empty filter', () => {
    render(<SlashCommandMenu {...defaultProps} />)
    const listbox = screen.getByRole('listbox')
    expect(listbox).toBeInTheDocument()
    // Each command should appear as an option.
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(SLASH_COMMANDS.length)
  })

  it('shows "no matching commands" when filter yields nothing', () => {
    render(
      <SlashCommandMenu {...defaultProps} filter="zzzz" />
    )
    expect(screen.getByText(/no matching commands/i)).toBeInTheDocument()
  })

  it('highlights the row at selectedIndex', () => {
    render(
      <SlashCommandMenu {...defaultProps} selectedIndex={1} />
    )
    const options = screen.getAllByRole('option')
    // The second row should be aria-selected true.
    expect(options[1]).toHaveAttribute('aria-selected', 'true')
    // The first row should not.
    expect(options[0]).toHaveAttribute('aria-selected', 'false')
  })

  it('mouse click on a row calls onSelect with the command name', () => {
    const onSelect = vi.fn()
    render(
      <SlashCommandMenu {...defaultProps} onSelect={onSelect} />
    )
    // Click the first command row.
    const options = screen.getAllByRole('option')
    // Use mouseDown (our component uses mouseDown to prevent blur).
    options[0].dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    )
    expect(onSelect).toHaveBeenCalledWith(SLASH_COMMANDS[0].name)
  })
})
