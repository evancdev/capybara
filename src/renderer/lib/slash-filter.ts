import {
  SLASH_COMMANDS,
  type SlashCommandSpec
} from '@/shared/types/commands'

/**
 * Filter SLASH_COMMANDS by case-insensitive prefix on the command name.
 * Pure prefix match — substring/fuzzy is intentionally out of scope.
 */
export function filterSlashCommands(
  filter: string
): readonly SlashCommandSpec[] {
  if (filter === '') return SLASH_COMMANDS
  const needle = filter.toLowerCase()
  return SLASH_COMMANDS.filter((c) => c.name.startsWith(needle))
}
