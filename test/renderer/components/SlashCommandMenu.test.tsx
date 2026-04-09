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
    matches: SLASH_COMMANDS,
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

  it('shows "no matching commands" when matches is empty', () => {
    render(
      <SlashCommandMenu {...defaultProps} matches={[]} />
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

  it('empty state has a dismiss button that calls onDismiss', () => {
    const onDismiss = vi.fn()
    render(
      <SlashCommandMenu
        {...defaultProps}
        matches={[]}
        onDismiss={onDismiss}
      />
    )
    const dismissBtn = screen.getByLabelText('Dismiss suggestions')
    dismissBtn.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    )
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('each command row shows the command name with a leading slash', () => {
    render(<SlashCommandMenu {...defaultProps} />)
    for (const cmd of SLASH_COMMANDS) {
      expect(screen.getByText(`/${cmd.name}`)).toBeInTheDocument()
    }
  })

  it('each command row shows its description', () => {
    render(<SlashCommandMenu {...defaultProps} />)
    for (const cmd of SLASH_COMMANDS) {
      expect(screen.getByText(cmd.description)).toBeInTheDocument()
    }
  })

  it('shows usage hint for /model (which differs from name)', () => {
    render(<SlashCommandMenu {...defaultProps} />)
    // /model has usage: "/model <name>" which differs from just "/model"
    expect(screen.getByText('/model <name>')).toBeInTheDocument()
  })

  it('does not show usage for commands where usage matches the name', () => {
    render(<SlashCommandMenu {...defaultProps} />)
    // /compact has usage: "/compact" which matches `/${name}` — so the usage
    // span should not render for it.
    const compactUsages = screen.queryAllByText('/compact')
    // There should be exactly one (the .name span), not two.
    expect(compactUsages).toHaveLength(1)
  })

  it('shows only /compact when matches contains just compact', () => {
    const compactOnly = filterSlashCommands('co')
    render(<SlashCommandMenu {...defaultProps} matches={compactOnly} />)
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(1)
    expect(screen.getByText('/compact')).toBeInTheDocument()
  })

  it('empty state option has aria-selected=false', () => {
    render(<SlashCommandMenu {...defaultProps} matches={[]} />)
    const option = screen.getByRole('option')
    expect(option).toHaveAttribute('aria-selected', 'false')
  })

  it('selectedIndex beyond matches does not crash', () => {
    // selectedIndex=99 but only 4 commands exist
    render(<SlashCommandMenu {...defaultProps} selectedIndex={99} />)
    const options = screen.getAllByRole('option')
    // All should be aria-selected=false since 99 > length
    for (const opt of options) {
      expect(opt).toHaveAttribute('aria-selected', 'false')
    }
  })

  it('listbox role is present with accessible label', () => {
    render(<SlashCommandMenu {...defaultProps} />)
    const listbox = screen.getByRole('listbox', {
      name: /slash command suggestions/i
    })
    expect(listbox).toBeInTheDocument()
  })
})
