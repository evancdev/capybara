export const MAX_AGENTS_PER_PROJECT = 5

export const IPC = {
  SESSION_CREATE: 'session:create',
  SESSION_DESTROY: 'session:destroy',
  SESSION_LIST: 'session:list',
  SESSION_RESIZE: 'session:resize',
  TERMINAL_OUTPUT: 'terminal:output',
  TERMINAL_INPUT: 'terminal:input',
  SESSION_EXITED: 'session:exited',
  SESSION_RENAME: 'session:rename',
  SESSION_REPLAY: 'session:replay',
  DIALOG_OPEN_DIRECTORY: 'dialog:openDirectory',
  GET_PROMPT_INFO: 'system:getPromptInfo',
  SESSION_GET_HISTORY: 'session:getHistory',
  SESSION_LIST_CONVERSATIONS: 'session:listConversations'
} as const
