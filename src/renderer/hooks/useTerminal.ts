import { useEffect, useRef, useCallback } from 'react'
import type { RefObject } from 'react'
import { Terminal } from '@xterm/xterm'
import type { ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import { useSession } from '@/renderer/context/SessionContext'
import { useTerminalDispatch } from '@/renderer/context/TerminalDispatchContext'
import { useTheme } from '@/renderer/context/ThemeContext'

const SCROLLBACK = 5_000

// Attaches a debounced scroll-to-top listener that triggers a history rebuild
// when the user scrolls to the very top and the xterm buffer has overflowed.
// Uses the internal `.xterm-viewport` class — not part of xterm's public API.
function attachScrollToTopDetection(
  container: HTMLElement,
  refs: {
    bufferOverflowed: { current: boolean }
    rebuilding: { current: boolean }
    writing: { current: boolean }
    scrollTopTimer: { current: ReturnType<typeof setTimeout> | null }
  },
  onScrollToTop: () => void
): { dispose: () => void } | null {
  const viewportEl = container.querySelector('.xterm-viewport')
  if (!viewportEl) return null

  const onScroll = (): void => {
    if (refs.scrollTopTimer.current !== null) {
      clearTimeout(refs.scrollTopTimer.current)
      refs.scrollTopTimer.current = null
    }

    if (
      viewportEl.scrollTop === 0 &&
      refs.bufferOverflowed.current &&
      !refs.rebuilding.current &&
      !refs.writing.current
    ) {
      refs.scrollTopTimer.current = setTimeout(() => {
        if (
          viewportEl.scrollTop === 0 &&
          refs.bufferOverflowed.current &&
          !refs.rebuilding.current &&
          !refs.writing.current
        ) {
          onScrollToTop()
        }
      }, 500)
    }
  }
  viewportEl.addEventListener('scroll', onScroll)
  return {
    dispose: () => {
      viewportEl.removeEventListener('scroll', onScroll)
      if (refs.scrollTopTimer.current !== null) {
        clearTimeout(refs.scrollTopTimer.current)
        refs.scrollTopTimer.current = null
      }
    }
  }
}

function loadWebgl(terminal: Terminal): WebglAddon | null {
  try {
    const addon = new WebglAddon()
    terminal.loadAddon(addon)
    addon.onContextLoss(() => {
      try {
        addon.dispose()
      } catch {
        /* already disposed */
      }
    })
    return addon
  } catch {
    return null
  }
}

function createTerminal(
  container: HTMLElement,
  colors: ITheme
): { terminal: Terminal; fitAddon: FitAddon; webglAddon: WebglAddon | null } {
  const terminal = new Terminal({
    cursorBlink: true,
    fontSize: 14,
    fontFamily: 'monospace',
    scrollback: SCROLLBACK,
    theme: colors
  })

  const fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  terminal.open(container)

  const webglAddon = loadWebgl(terminal)

  fitAddon.fit()
  return { terminal, fitAddon, webglAddon }
}

export function useTerminal(
  sessionId: string,
  containerRef: RefObject<HTMLDivElement | null>,
  cwd: string
): void {
  const { activeSessionId } = useSession()
  const { registerTerminalHandler, unregisterTerminalHandler } =
    useTerminalDispatch()
  const { theme } = useTheme()
  const terminalColorsRef = useRef(theme.terminal)
  terminalColorsRef.current = theme.terminal
  const terminalRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const webglAddonRef = useRef<WebglAddon | null>(null)
  const resizeObserverRef = useRef<ResizeObserver | null>(null)
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Track whether the xterm buffer has overflowed (oldest lines dropped)
  const bufferOverflowedRef = useRef(false)
  // Prevent multiple concurrent history rebuilds
  const rebuildingRef = useRef(false)
  // Track the scroll listener so we can clean it up
  const scrollDisposableRef = useRef<{ dispose: () => void } | null>(null)
  // Suppress scroll-to-top detection during writes
  const writingRef = useRef(false)
  const writeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Debounce scroll-to-top detection
  const scrollTopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Track whether the main effect has been disposed
  const disposedRef = useRef(false)

  // Mark that a write is happening — suppresses scroll-to-top detection
  // for a short window after each write to avoid false triggers from reflow
  const markWrite = useCallback(() => {
    writingRef.current = true
    if (writeTimerRef.current !== null) {
      clearTimeout(writeTimerRef.current)
    }
    writeTimerRef.current = setTimeout(() => {
      writingRef.current = false
    }, 200)
  }, [])

  // Rebuild terminal with full history from the main process
  const rebuildWithHistory = useCallback(async () => {
    if (rebuildingRef.current) return
    const container = containerRef.current
    const oldTerminal = terminalRef.current
    const oldFitAddon = fitAddonRef.current
    if (!container || !oldTerminal) return

    rebuildingRef.current = true

    try {
      const history = await window.sessionAPI.getSessionHistory(sessionId)
      if (!history) {
        rebuildingRef.current = false
        return
      }

      if (disposedRef.current) {
        rebuildingRef.current = false
        return
      }

      // Dispose old terminal
      scrollDisposableRef.current?.dispose()
      scrollDisposableRef.current = null
      webglAddonRef.current?.dispose()
      oldFitAddon?.dispose()
      oldTerminal.dispose()

      // Create fresh terminal with full history
      const { terminal, fitAddon, webglAddon } = createTerminal(
        container,
        terminalColorsRef.current
      )

      writingRef.current = true
      terminal.write(history)

      // Scroll to top since the user was trying to see older content
      terminal.scrollToTop()

      // Keep write suppression active briefly after rebuild
      if (writeTimerRef.current !== null) {
        clearTimeout(writeTimerRef.current)
      }
      writeTimerRef.current = setTimeout(() => {
        writingRef.current = false
      }, 500)

      // Re-wire input
      const inputDisposable = terminal.onData((data: string) => {
        window.sessionAPI.sendInput(sessionId, data)
      })

      // Re-wire live output handler — direct write since replay is done
      registerTerminalHandler(sessionId, (data: string) => {
        markWrite()
        terminal.write(data)
      })

      // Monitor for buffer overflow again
      bufferOverflowedRef.current = false
      const scrollListener = terminal.onScroll(() => {
        if (bufferOverflowedRef.current) return
        if (terminal.buffer.active.baseY >= SCROLLBACK) {
          bufferOverflowedRef.current = true
        }
      })

      // Re-attach scroll-to-top detection (debounced, write-suppressed)
      const scrollDetection = attachScrollToTopDetection(
        container,
        {
          bufferOverflowed: bufferOverflowedRef,
          rebuilding: rebuildingRef,
          writing: writingRef,
          scrollTopTimer: scrollTopTimerRef
        },
        () => {
          void rebuildWithHistory()
        }
      )
      scrollDisposableRef.current = {
        dispose: () => {
          scrollDetection?.dispose()
          scrollListener.dispose()
          inputDisposable.dispose()
        }
      }

      terminalRef.current = terminal
      fitAddonRef.current = fitAddon
      webglAddonRef.current = webglAddon
    } finally {
      rebuildingRef.current = false
    }
  }, [sessionId, containerRef, registerTerminalHandler, markWrite])

  useEffect(() => {
    disposedRef.current = false
    const container = containerRef.current
    if (!container) return

    const colors = terminalColorsRef.current
    const { terminal, fitAddon, webglAddon } = createTerminal(container, colors)

    let disposed = false
    bufferOverflowedRef.current = false

    // Write a synthetic shell prompt so the user sees what command is running.
    const basename = cwd.split('/').pop() ?? cwd
    window.sessionAPI
      .getPromptInfo()
      .then(({ username, hostname }) => {
        if (disposed) return
        terminal.write(
          `\x1b[2m${username}@${hostname} ${basename} % claude\x1b[0m\r\n`
        )
      })
      .catch(() => {
        if (disposed) return
        terminal.write('\x1b[2m$ claude\x1b[0m\r\n')
      })

    // --- No-data-loss streaming strategy ---
    //
    // Register the live handler FIRST in "queue mode" so it captures
    // everything, then replay the buffered history, then flush the queue
    // and switch to direct writes.
    //
    // The main-side replay uses snapshotAndClearBuffer(), which atomically
    // returns the buffer and clears it. Data is either in the snapshot OR
    // in the live stream — never both — no duplicates and no data loss.
    let replayDone = false
    const pendingQueue: string[] = []

    registerTerminalHandler(sessionId, (data: string) => {
      if (disposed) return
      if (!replayDone) {
        pendingQueue.push(data)
      } else {
        markWrite()
        terminal.write(data)
      }
    })

    window.sessionAPI
      .replaySession(sessionId)
      .then((buffered) => {
        if (disposed) return
        if (buffered) {
          markWrite()
          terminal.write(buffered)
        }
      })
      .catch(() => {
        // Replay failed — proceed without historical output
      })
      .finally(() => {
        if (disposed) return
        replayDone = true
        if (pendingQueue.length > 0) {
          markWrite()
          for (const chunk of pendingQueue) {
            terminal.write(chunk)
          }
        }
        pendingQueue.length = 0
      })

    // Wire up user input -> main process
    const inputDisposable = terminal.onData((data: string) => {
      window.sessionAPI.sendInput(sessionId, data)
    })

    // Monitor for buffer overflow — when baseY hits scrollback limit,
    // xterm has started dropping old lines
    const scrollListener = terminal.onScroll(() => {
      if (bufferOverflowedRef.current) return
      if (terminal.buffer.active.baseY >= SCROLLBACK) {
        bufferOverflowedRef.current = true
      }
    })

    // Detect user scrolling to the very top when buffer has overflowed.
    const scrollDetection = attachScrollToTopDetection(
      container,
      {
        bufferOverflowed: bufferOverflowedRef,
        rebuilding: rebuildingRef,
        writing: writingRef,
        scrollTopTimer: scrollTopTimerRef
      },
      () => {
        void rebuildWithHistory()
      }
    )
    scrollDisposableRef.current = {
      dispose: () => {
        scrollDetection?.dispose()
        scrollListener.dispose()
        inputDisposable.dispose()
      }
    }

    // ResizeObserver for auto-fit
    let lastCols = terminal.cols
    let lastRows = terminal.rows
    const resizeObserver = new ResizeObserver(() => {
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current)
      }
      debounceTimerRef.current = setTimeout(() => {
        try {
          fitAddon.fit()
          terminal.scrollToBottom()

          const { cols, rows } = terminal
          if (cols !== lastCols || rows !== lastRows) {
            lastCols = cols
            lastRows = rows
            void window.sessionAPI.resizeSession({ sessionId, cols, rows })
          }
        } catch {
          // Terminal may be disposed during cleanup
        }
      }, 100)
    })
    resizeObserver.observe(container)

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon
    webglAddonRef.current = webglAddon
    resizeObserverRef.current = resizeObserver

    // Focus the terminal only if its container is visible
    if (container.offsetParent !== null) {
      terminal.focus()
    }

    return () => {
      disposed = true
      disposedRef.current = true
      if (debounceTimerRef.current !== null) {
        clearTimeout(debounceTimerRef.current)
      }
      if (writeTimerRef.current !== null) {
        clearTimeout(writeTimerRef.current)
      }
      resizeObserver.disconnect()
      scrollDisposableRef.current?.dispose()
      scrollDisposableRef.current = null
      unregisterTerminalHandler(sessionId)
      webglAddonRef.current?.dispose()
      fitAddonRef.current?.dispose()
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
      webglAddonRef.current = null
      resizeObserverRef.current = null
    }
  }, [
    sessionId,
    containerRef,
    cwd,
    registerTerminalHandler,
    unregisterTerminalHandler,
    rebuildWithHistory,
    markWrite
  ])

  // Focus terminal when this session becomes the active one
  useEffect(() => {
    if (activeSessionId !== sessionId) return
    const terminal = terminalRef.current
    const container = containerRef.current
    if (!terminal || !container) return
    if (container.offsetParent !== null) {
      terminal.focus()
    }
  }, [activeSessionId, sessionId, containerRef])

  // Live-update terminal colors when theme changes.
  // The WebGL addon caches its texture atlas with the old colors,
  // so we dispose and recreate it after changing the theme.
  useEffect(() => {
    const terminal = terminalRef.current
    if (!terminal) return
    terminal.options.theme = theme.terminal

    // Recreate WebGL addon to flush its color cache
    if (webglAddonRef.current) {
      try {
        webglAddonRef.current.dispose()
      } catch {
        // may already be disposed
      }
    }
    webglAddonRef.current = loadWebgl(terminal)

    // Force a full redraw — the new renderer needs to paint all cells
    terminal.refresh(0, terminal.rows - 1)
  }, [theme.terminal])
}
