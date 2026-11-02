// Orca-Pit: what the WhatsApp chats need of this desktop — the Orca chat host and the few runtime
// calls around it (workspace, support, tab, the group's old terminal chat) — as one port, so the
// chats' logic runs in tests without a runtime.
import type { AgentJournalSnapshot } from '../../shared/agent-session-journal-types'
import type { StructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-host'
import type { WhatsappChatKey, WhatsappInboxGroup } from './orca-pit-whatsapp-chat-types'
import type { WhatsappBridgeState, WhatsappChatLink } from './orca-pit-whatsapp-state'

/** What the WhatsApp chats call on the chat host. */
export type WhatsappChatHost = Pick<
  StructuredAgentSessionHost,
  | 'send'
  | 'waitForSendSettlement'
  | 'respondToPrompt'
  | 'journalSnapshot'
  | 'readStatusSummary'
  | 'subscribeTurnCompletions'
  | 'subscribeStatus'
  | 'setUserConversationName'
  | 'isSessionTabVisible'
> & {
  deps: {
    store: Pick<StructuredAgentSessionHost['deps']['store'], 'requireWritableRecord'>
  }
}

/** A refused create says when: `prepare` refusals made nothing and are not recorded, so the same
 *  ids retry; a `commit` refusal is recorded against its ids and would replay. */
export type WhatsappChatCreated =
  | { ok: true }
  | { ok: false; code: string; stage: 'prepare' | 'commit' }

export type WhatsappChatCreate = {
  worktreeId: string
  sessionId: string
  operationId: string
  openingMessageId: string
  text: string
  /** The agent session to resume (an old terminal chat's); absent starts a fresh one. */
  resumeProviderSessionId?: string
}

/** The group's old terminal chat, from the time WhatsApp chats were terminals. */
export type WhatsappLegacyChat = {
  worktreeId: string
  paneKey: string
  providerSessionId: string | null
}

export type WhatsappChatsDeps = {
  state: WhatsappBridgeState
  /** The chat host, installed on demand; null when this runtime cannot run chats. */
  host: () => Promise<WhatsappChatHost | null>
  /** Whether a chat opens in the workspace (or, before it exists, in the group's project); null
   *  when that cannot be told yet, which the create then settles. */
  chatSupported: (
    group: WhatsappInboxGroup,
    worktreeId: string | undefined
  ) => Promise<boolean | null>
  /** The new chat's workspace (a worktree of its own, or the folder project); null without one. */
  openWorkspace: (
    group: WhatsappInboxGroup,
    externalId: string,
    onCreated: (worktreeId: string) => void
  ) => Promise<string | null>
  workspaceExists: (worktreeId: string) => Promise<boolean>
  /** Makes the chat at rest with its opening message, its tab shown; a refusal names its code. */
  createChat: (input: WhatsappChatCreate) => Promise<WhatsappChatCreated>
  /** Shows the chat's tab again after someone closed it. */
  showTab: (sessionId: string) => Promise<void>
  legacyChat: (key: WhatsappChatKey) => WhatsappLegacyChat | null
  stopLegacyTerminal: (paneKey: string) => Promise<void>
  /** A host operation id (`<13-digit ms>-<32 hex>`) and a new chat's session id. */
  mintOperationId: () => string
  mintSessionId: () => string
  sleep: (ms: number) => Promise<void>
  log: (message: string, error?: unknown) => void
}

/** Scopes the chat host's operation ledger to the WhatsApp bridge. */
export const WHATSAPP_CHAT_CALLER = {
  callerKey: 'trusted-local:orca-pit-whatsapp'
}

export function whatsappChatKeyOf(externalId: string): WhatsappChatKey {
  return { source: 'whatsapp', externalId }
}

/** The chat's journal, read at rest (no agent starts for it); null when it cannot be read. */
export async function readChatJournal(
  deps: Pick<WhatsappChatsDeps, 'host' | 'log'>,
  link: Pick<WhatsappChatLink, 'sessionId'>
): Promise<AgentJournalSnapshot | null> {
  const host = await deps.host()
  if (!host) {
    return null
  }
  try {
    return await host.journalSnapshot(link.sessionId)
  } catch (error) {
    deps.log(`reading chat ${link.sessionId} failed`, error)
    return null
  }
}

/** The fence a write to the chat must name; null when the chat can no longer be written. */
export function writableFence(host: WhatsappChatHost, sessionId: string): number | null {
  try {
    return host.deps.store.requireWritableRecord(sessionId).lease.runtimeFence
  } catch {
    return null
  }
}
