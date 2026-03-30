# Changelog

All notable changes to Capybara are documented in this file.

## [0.1.0] - 2026-03-29

Initial release. Capybara is a desktop app for running multiple Claude Code CLI sessions simultaneously in one window.

### Added

- **Multi-session management** -- spawn, rename, and kill Claude Code sessions backed by node-pty
- **Two-level tab layout** -- horizontal project tabs with vertical agent tabs per project
- **Folder picker** -- open any directory as a project via native OS dialog
- **Agent naming** -- auto-generated "Agent N" names, renamable via double-click or F2
- **Session status indicators** -- running/exited states with exit code display
- **Conversation history** -- list past Claude Code conversations and resume them in a new session
- **Terminal emulation** -- xterm.js with WebGL rendering and automatic resize
- **Settings panel** -- theme selection (12 presets, dark and light) and keybinding customization with live shortcut recorder
- **Keyboard shortcuts** -- Cmd+T new agent, Cmd+W close agent, Cmd+N new project, Cmd+Shift+W close project, Cmd+1-9 switch agents, Cmd+, settings, Escape close settings (all rebindable)
- **Clean process cleanup** -- graceful shutdown on quit, window close, SIGTERM, SIGINT, and uncaught exceptions with a 5-second force-exit timeout
- **Cross-platform packaging** -- macOS universal DMG (hardened runtime, notarization), Windows NSIS installer, Linux AppImage

---

Written by a teams of capybaras.
