// Orca-Pit: each WhatsApp group's conversation as a native Orca chat — the structured session a
// "new chat" tab opens, never the agent's terminal. The chat opens in view, as a tab of the
// project named after the group (an agent never runs hidden here); the group's messages are its
// turns, the end of each turn and the agent's questions come back from the chat host. A machine
// that cannot run a chat refuses the message with a reason the group reads; it never falls back
// to a terminal. A group whose chat is still an old terminal one moves to a chat that resumes the
// same agent session, after that terminal is closed (two writers would split the conversation).
import type { PendingPrompt } from '../../shared/agent-pending-prompt'
import { computeAgentSessionPayloadFingerprint } from '../../shared/agent-session-mutation-envelope'
import { sendAgentTurn } from '../runtime/orchestration/send-agent-turn'
import {
  refusedDelivery,
  type WhatsappChatKey,
  type WhatsappChatListener,
  type WhatsappDelivery,
  type WhatsappInboxGroup
} from './orca-pit-whatsapp-chat-types'
import {
  chatPrompt,
  pendingPromptItem,
  promptAnswer,
  sendHeld
} from './orca-pit-whatsapp-chat-journal'
import { WhatsappChatEvents } from './orca-pit-whatsapp-chat-events'
import {
  readChatJournal,
  WHATSAPP_CHAT_CALLER,
  writableFence,
  type WhatsappChatCreated,
  type WhatsappChatsDeps
} from './orca-pit-whatsapp-chat-host'
import type { WhatsappChatLink } from './orca-pit-whatsapp-state'

export type {
  WhatsappChatCreate,
  WhatsappChatCreated,
  WhatsappChatHost,
  WhatsappChatsDeps
} from './orca-pit-whatsapp-chat-host'

// Why 10 × 500 ms: a closed terminal's agent takes a moment to exit; resuming before is refused.
const RESUME_ATTEMPTS = 10
const RESUME_RETRY_MS = 500

/** The chat is gone for good; a new one takes its place. */
const LOST_CODES = new Set(['agent_session_identity_required', 'agent_session_journal_unreadable'])

function refusalOfCode(code: string): WhatsappDelivery {
  if (code === 'structured_agent_session_unsupported') {
    return refusedDelivery('chat_unavailable')
  }
  return refusedDelivery(LOST_CODES.has(code) ? 'chat_lost' : 'not_delivered')
}

export class WhatsappChats {
  private readonly events: WhatsappChatEvents

  constructor(private readonly deps: WhatsappChatsDeps) {
    this.events = new WhatsappChatEvents(deps)
  }

  hasChat(key: WhatsappChatKey): boolean {
    return this.deps.state.link(key.externalId)?.created === true
  }

  async start(
    key: WhatsappChatKey,
    group: WhatsappInboxGroup,
    prompt: string
  ): Promise<WhatsappDelivery> {
    const { state } = this.deps
    const host = await this.deps.host()
    if (!host) {
      return refusedDelivery('chat_unavailable')
    }
    this.events.attach(host)
    let link = state.link(key.externalId) ?? this.newLink(key)
    if (link.created) {
      return { outcome: 'accepted' }
    }
    if (link.worktreeId && !(await this.deps.workspaceExists(link.worktreeId))) {
      // Its workspace was removed before the chat was made: nothing there to resume.
      const { worktreeId: _gone, resumeProviderSessionId: _session, ...rest } = link
      link = rest
      state.setLink(key.externalId, link)
    }
    if ((await this.deps.chatSupported(group, link.worktreeId)) === false) {
      return refusedDelivery('chat_unavailable')
    }
    if (!link.worktreeId) {
      const worktreeId = await this.deps.openWorkspace(group, key.externalId, (created) => {
        link = { ...link, worktreeId: created }
        state.setLink(key.externalId, link)
      })
      if (!worktreeId) {
        return refusedDelivery('not_delivered')
      }
      link = { ...link, worktreeId }
      state.setLink(key.externalId, link)
    }
    const created = await this.create(key, link, prompt)
    if (!created.ok) {
      if (created.stage === 'commit' && created.code !== 'agent_session_operation_unknown') {
        // The host recorded this refusal against the ids; new ones let the next message retry.
        state.setLink(key.externalId, { ...(state.link(key.externalId) ?? link), ...this.newIds() })
      }
      return refusedDelivery(
        created.code === 'structured_agent_session_unsupported'
          ? 'chat_unavailable'
          : 'not_delivered'
      )
    }
    link = { ...(state.link(key.externalId) ?? link), created: true }
    state.setLink(key.externalId, link)
    // The tab says which group it answers.
    await host.setUserConversationName(link.sessionId, group.name, 'rename').catch((error) => {
      this.deps.log('could not name the group chat', error)
    })
    void this.events.watchOpening(host, key, link)
    return { outcome: 'accepted' }
  }

  async send(key: WhatsappChatKey, deliveryId: string, text: string): Promise<WhatsappDelivery> {
    const { state } = this.deps
    const link = state.link(key.externalId)
    if (!link?.created || !link.worktreeId) {
      return refusedDelivery('chat_lost')
    }
    const host = await this.deps.host()
    if (!host) {
      return refusedDelivery('chat_unavailable')
    }
    this.events.attach(host)
    const fence = writableFence(host, link.sessionId)
    if (fence === null || !(await this.deps.workspaceExists(link.worktreeId))) {
      return refusedDelivery('chat_lost')
    }
    if (!host.isSessionTabVisible(link.sessionId)) {
      // Someone closed the tab; the agent never works out of sight, so it comes back first.
      await this.deps.showTab(link.sessionId)
    }
    const operationId =
      link.sends.find((sent) => sent.deliveryId === deliveryId)?.operationId ??
      this.deps.mintOperationId()
    state.setLink(key.externalId, {
      ...link,
      sends: [
        ...link.sends.filter((sent) => sent.deliveryId !== deliveryId),
        { deliveryId, operationId }
      ]
    })
    const outcome = await sendAgentTurn({
      kind: 'structured-session',
      host,
      sessionId: link.sessionId,
      callerKey: WHATSAPP_CHAT_CALLER.callerKey,
      turn: {
        body: {
          kind: 'message',
          role: 'user',
          blocks: [{ type: 'text', text }]
        },
        operationId,
        expectedRuntimeFence: fence,
        // As a person's message: a busy chat holds it and sends it when its turn ends.
        delivery: 'queue'
      }
    })
    if (outcome.kind === 'refused') {
      this.deps.log(`chat of ${key.externalId} refused the message: ${outcome.refusal.message}`)
      return refusalOfCode(outcome.refusal.code)
    }
    if (outcome.kind === 'sent' && outcome.submission?.dispatchState === 'rejected') {
      return refusedDelivery('not_delivered')
    }
    return { outcome: 'accepted' }
  }

  /** The chat still holds its opening for an agent that has not taken it yet. */
  async openingHeld(key: WhatsappChatKey): Promise<boolean> {
    const link = this.deps.state.link(key.externalId)
    const journal = link?.created ? await readChatJournal(this.deps, link) : null
    return link && journal ? sendHeld(journal.submissions, link.openingMessageId) : false
  }

  async pendingPrompt(key: WhatsappChatKey): Promise<PendingPrompt | null> {
    const link = this.deps.state.link(key.externalId)
    const host = link?.created ? await this.deps.host() : null
    const status = link ? host?.readStatusSummary(link.sessionId)?.status : undefined
    if (!link || !host || (status && status !== 'attention')) {
      return null
    }
    const journal = await readChatJournal(this.deps, link)
    const item = journal ? pendingPromptItem(journal.items) : null
    return item ? chatPrompt(item) : null
  }

  async answer(
    key: WhatsappChatKey,
    promptId: string,
    optionId: string
  ): Promise<WhatsappDelivery> {
    const link = this.deps.state.link(key.externalId)
    const host = link?.created ? await this.deps.host() : null
    const journal = link && host ? await readChatJournal(this.deps, link) : null
    const item = journal ? pendingPromptItem(journal.items, promptId) : null
    const fence = link && host ? writableFence(host, link.sessionId) : null
    if (!link || !host || !item || fence === null) {
      return refusedDelivery('prompt_not_pending')
    }
    const answer = promptAnswer(item, optionId)
    if (!answer) {
      return refusedDelivery('option_not_offered')
    }
    const fields = {
      itemId: answer.itemId,
      expectedRevision: answer.expectedRevision,
      optionId: answer.optionId,
      answers: answer.answers
    }
    const answered = await host.respondToPrompt(WHATSAPP_CHAT_CALLER, {
      ...answer,
      envelope: {
        sessionId: link.sessionId,
        clientOperationId: this.deps.mintOperationId(),
        expectedRuntimeFence: fence,
        payloadFingerprint: computeAgentSessionPayloadFingerprint({
          method: `agentSession.respondTo:${answer.kind}`,
          sessionId: link.sessionId,
          fields
        })
      }
    })
    if (!answered.ok) {
      this.deps.log(`answer to ${key.externalId} refused: ${answered.refusal.message}`)
      return refusedDelivery('prompt_not_pending')
    }
    return { outcome: 'accepted' }
  }

  watch(listener: WhatsappChatListener): () => void {
    return this.events.watch(listener)
  }

  dispose(): void {
    this.events.dispose()
  }

  private newLink(key: WhatsappChatKey): WhatsappChatLink {
    const legacy = this.deps.legacyChat(key)
    const link: WhatsappChatLink = {
      ...this.newIds(),
      sends: [],
      ...(legacy ? { worktreeId: legacy.worktreeId } : {}),
      ...(legacy?.providerSessionId ? { resumeProviderSessionId: legacy.providerSessionId } : {})
    }
    this.deps.state.setLink(key.externalId, link)
    return link
  }

  private newIds(): Pick<WhatsappChatLink, 'sessionId' | 'createOperationId' | 'openingMessageId'> {
    return {
      sessionId: this.deps.mintSessionId(),
      createOperationId: this.deps.mintOperationId(),
      openingMessageId: this.deps.mintOperationId()
    }
  }

  /** Makes the chat; an old terminal chat's session is resumed once its terminal is gone. */
  private async create(
    key: WhatsappChatKey,
    link: WhatsappChatLink,
    text: string
  ): Promise<WhatsappChatCreated> {
    const base = {
      worktreeId: link.worktreeId!,
      sessionId: link.sessionId,
      operationId: link.createOperationId,
      openingMessageId: link.openingMessageId,
      text
    }
    const resumed = link.resumeProviderSessionId
    if (!resumed) {
      return this.deps.createChat(base)
    }
    const legacy = this.deps.legacyChat(key)
    if (legacy) {
      await this.deps.stopLegacyTerminal(legacy.paneKey)
    }
    let created = await this.deps.createChat({
      ...base,
      resumeProviderSessionId: resumed
    })
    for (let attempt = 1; !created.ok && attempt < RESUME_ATTEMPTS; attempt += 1) {
      if (created.code !== 'agent_session_conflict') {
        break
      }
      await this.deps.sleep(RESUME_RETRY_MS)
      created = await this.deps.createChat({
        ...base,
        resumeProviderSessionId: resumed
      })
    }
    if (created.ok || created.code === 'structured_agent_session_unsupported') {
      return created
    }
    // The old session cannot be resumed (its transcript is gone, say): a fresh chat in the same
    // workspace, under new ids, since the refused create's ids name the resume.
    this.deps.log(`chat ${key.externalId} could not resume ${resumed} (${created.code}); fresh`)
    const { resumeProviderSessionId: _dropped, ...rest } = link
    const fresh: WhatsappChatLink = { ...rest, ...this.newIds() }
    this.deps.state.setLink(key.externalId, fresh)
    return this.deps.createChat({
      ...base,
      sessionId: fresh.sessionId,
      operationId: fresh.createOperationId,
      openingMessageId: fresh.openingMessageId
    })
  }
}
