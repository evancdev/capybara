/** Result of evaluating whether a tool invocation should be allowed. */
export interface ToolApprovalResult {
  behavior: 'allow' | 'ask_user'
}
