import type { ClaudeConnection } from '@/main/claude/connection'
import type { SessionService } from '@/main/services/session'
import { InvalidCommandArgsError } from '@/main/lib/errors'
import { logger } from '@/main/lib/logger'
import { CYCLING_EFFORT_LEVELS } from '@/shared/types/session'
import type { EffortLevel } from '@/shared/types/session'

/**
 * Context handed to a main-scoped slash command handler. Scoped deliberately
 * narrow: the handler gets the session it was invoked against plus the
 * owning service, nothing more. Avoids circular imports by parameterising on
 * `SessionService` rather than importing concrete state.
 */
export interface MainCommandContext {
  sessionId: string
  cwd: string
  args: string[]
  sessionService: SessionService
  connection: ClaudeConnection
}

export interface MainSlashCommand {
  name: string
  handler: (ctx: MainCommandContext) => Promise<{ newSessionId?: string }>
}

export type MainSlashCommandRegistry = Record<string, MainSlashCommand>

/**
 * Canonical registry of main-dispatched slash commands. Wired into
 * `SessionService` at the composition root (see `src/main/index.ts`).
 */
export const MAIN_COMMANDS: MainSlashCommandRegistry = {
  compact: {
    name: 'compact',
    handler: (ctx) => {
      ctx.connection.send(
        'Please summarize the conversation so far into a concise brief that captures the goals, the key decisions, and any outstanding work. Keep it terse.'
      )
      return Promise.resolve({})
    }
  },
  model: {
    name: 'model',
    handler: (ctx) => {
      const name = ctx.args[0]?.trim() ?? ''
      if (name.length === 0) {
        throw new InvalidCommandArgsError('Usage: /model <name>')
      }
      ctx.connection.setModel(name)
      ctx.sessionService.notifyMetadataUpdated(ctx.sessionId)
      logger.info('Slash /model applied', {
        sessionId: ctx.sessionId,
        model: name
      })
      return Promise.resolve({})
    }
  },
  init: {
    name: 'init',
    handler: (ctx) => {
      ctx.connection.send(
        "Please analyze this codebase and create a CLAUDE.md file at the project root. Include the project's purpose and primary tech stack, the main build/test/lint/typecheck commands, the high-level directory structure, and any non-obvious conventions a new contributor would need to know. Keep it concise — this file is loaded into every future conversation as context."
      )
      return Promise.resolve({})
    }
  },
  review: {
    name: 'review',
    handler: (ctx) => {
      ctx.connection.send(
        'Please review the recent changes in this branch. Check the git diff, identify any bugs, security issues, performance regressions, or style inconsistencies, and flag anything that needs attention before shipping. Be specific — cite files and line numbers.'
      )
      return Promise.resolve({})
    }
  },
  effort: {
    name: 'effort',
    handler: (ctx) => {
      const raw = ctx.args[0]?.trim().toLowerCase() ?? ''
      if (raw.length === 0) {
        throw new InvalidCommandArgsError(
          'Usage: /effort <low|medium|high|max>'
        )
      }
      const validLevels: readonly string[] = CYCLING_EFFORT_LEVELS
      if (!validLevels.includes(raw)) {
        throw new InvalidCommandArgsError(
          `Invalid effort level "${raw}". Must be one of: ${CYCLING_EFFORT_LEVELS.join(', ')}`
        )
      }
      const level = raw as EffortLevel
      ctx.connection.setEffort(level)
      ctx.sessionService.notifyMetadataUpdated(ctx.sessionId)
      logger.info('Slash /effort applied', {
        sessionId: ctx.sessionId,
        effort: level
      })
      return Promise.resolve({})
    }
  }
}
