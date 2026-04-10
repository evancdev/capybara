/**
 * Pure data module describing slash commands. Shared between renderer and
 * main so both sides agree on command names, descriptions, and dispatch
 * scope. No handlers live here — main handlers live in
 * `src/main/services/slash-commands.ts`.
 */

export type SlashCommandScope = 'renderer' | 'main'

export interface SlashCommandSpec {
  /** Command name without the leading slash. Lowercase. */
  name: string
  description: string
  usage?: string
  scope: SlashCommandScope
}

export const SLASH_COMMANDS: readonly SlashCommandSpec[] = [
  {
    name: 'compact',
    description: 'Ask the agent to summarize the conversation so far',
    usage: '/compact',
    scope: 'main'
  },
  {
    name: 'model',
    description: 'Switch the model used by the active session',
    usage: '/model <name>',
    scope: 'main'
  },
  {
    name: 'init',
    description: 'Ask the agent to analyze the codebase and create a CLAUDE.md',
    usage: '/init',
    scope: 'main'
  },
  {
    name: 'review',
    description: 'Ask the agent to review the recent changes in this branch',
    usage: '/review',
    scope: 'main'
  },
  {
    name: 'effort',
    description: 'Set reasoning effort level (low, medium, high, max)',
    usage: '/effort <low|medium|high|max>',
    scope: 'main'
  }
] as const

export function findSlashCommand(name: string): SlashCommandSpec | undefined {
  const needle = name.toLowerCase()
  return SLASH_COMMANDS.find((c) => c.name === needle)
}

export interface ParsedSlashInput {
  name: string
  args: string[]
}

/**
 * Parse a raw user input line into a slash command name and args. Returns
 * null if the line does not start with `/` or is empty after the slash.
 * Whitespace-splits args; does not support quoted strings.
 */
export function parseSlashInput(input: string): ParsedSlashInput | null {
  const trimmed = input.trim()
  if (!trimmed.startsWith('/')) return null
  const body = trimmed.slice(1).trim()
  if (body.length === 0) return null
  const parts = body.split(/\s+/)
  const [name, ...args] = parts
  if (name.length === 0) return null
  return { name: name.toLowerCase(), args }
}
