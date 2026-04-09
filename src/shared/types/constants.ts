export const MAX_AGENTS_PER_PROJECT = 5

/**
 * IPC channel names. Grouped by direction, then by namespace.
 *
 * - Renderer → Main: called via `ipcRenderer.invoke` and handled with `ipcMain.handle`.
 *   Request/response, returns a Promise.
 * - Main → Renderer: sent via `webContents.send` and received with `ipcRenderer.on`.
 *   Fire-and-forget, no return value.
 *
 * Keep the string values stable; preload and renderer depend on them.
 */
export const IPC = {
  // ── Renderer → Main

  // Session lifecycle
  SESSION_CREATE: 'session:create',
  SESSION_DESTROY: 'session:destroy',
  SESSION_STOP_RESPONSE: 'session:stopResponse',
  SESSION_LIST: 'session:list',

  // Session messaging
  SESSION_SEND_MESSAGE: 'session:sendMessage',
  SESSION_GET_MESSAGES: 'session:getMessages',

  // Session mode + slash commands
  SESSION_SET_PERMISSION_MODE: 'session:setPermissionMode',
  SESSION_RUN_COMMAND: 'session:runCommand',

  // Session conversations (history)
  SESSION_LIST_CONVERSATIONS: 'session:listConversations',
  SESSION_RENAME_CONVERSATION: 'session:renameConversation',

  // Tool approval (response leg)
  TOOL_APPROVAL_RESPONSE: 'session:toolApprovalResponse',

  // System
  DIALOG_OPEN_DIRECTORY: 'dialog:openDirectory',

  // ── Main → Renderer

  // Session events
  SESSION_MESSAGE: 'session:message',
  SESSION_EXITED: 'session:exited',

  // Tool approval (request leg)
  TOOL_APPROVAL_REQUEST: 'session:toolApprovalRequest',

  // System events
  USER_INFO: 'system:userInfo'
} as const
