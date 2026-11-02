// Orca-Pit: what the WhatsApp chats tell the bridge, read off the Orca chat host: a turn beginning
// (the chat starts working), a question waiting on the user, and the end of a turn with its reply.
// The host's turn edges are live only, so a watch also opens with a snapshot of every chat.
import {
  agentSessionSendSubmission,
  type AgentSessionStatusEvent,
  type AgentSessionTurnCompletionEvent
} from '../../shared/agent-session-wire'
import type {
  WhatsappChatEvent,
  WhatsappChatKey,
  WhatsappChatListener
} from './orca-pit-whatsapp-chat-types'
import {
  chatPrompt,
  chatStarted,
  pendingPromptItem,
  turnReply
} from './orca-pit-whatsapp-chat-journal'
import {
  readChatJournal,
  whatsappChatKeyOf,
  type WhatsappChatHost,
  type WhatsappChatsDeps
} from './orca-pit-whatsapp-chat-host'
import type { WhatsappChatLink } from './orca-pit-whatsapp-state'

// Why 2 min: a cold chat program with an update to apply can take a minute before it answers.
const OPENING_WAIT_MS = 120_000
const FAILED_TURN_TEXT = 'O agente parou com um erro neste turno. Veja o chat do grupo no Orca-Pit.'

type Snapshot = Extract<WhatsappChatEvent, { kind: 'snapshot' }>

export class WhatsappChatEvents {
  private readonly listeners = new Set<WhatsappChatListener>()
  private subscribed: { host: WhatsappChatHost; release: () => void } | null = null
  private readonly working = new Map<string, boolean>()

  constructor(private readonly deps: Pick<WhatsappChatsDeps, 'state' | 'host' | 'log'>) {}

  watch(listener: WhatsappChatListener): () => void {
    this.listeners.add(listener)
    void this.snapshot().then(
      (event) => {
        if (event && this.listeners.has(listener)) {
          listener(event)
        }
      },
      (error: unknown) => this.deps.log('reading the group chats failed', error)
    )
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Follows the chat host; a host built again (after chats restarted) is followed anew. */
  attach(host: WhatsappChatHost): void {
    if (this.subscribed?.host === host) {
      return
    }
    this.subscribed?.release()
    const stopCompletions = host.subscribeTurnCompletions({
      id: 'orca-pit-whatsapp',
      includePrompts: true,
      emit: (event) => void this.completion(host, event)
    })
    const stopStatus = host.subscribeStatus({
      id: 'orca-pit-whatsapp',
      emit: (event) => this.status(event)
    })
    this.subscribed = {
      host,
      release: () => {
        stopCompletions()
        stopStatus()
      }
    }
  }

  /** The agent taking the opening is the chat's first turn beginning. */
  async watchOpening(
    host: WhatsappChatHost,
    key: WhatsappChatKey,
    link: WhatsappChatLink
  ): Promise<void> {
    try {
      const settled = await host.waitForSendSettlement(link.sessionId, link.openingMessageId, {
        budgetMs: OPENING_WAIT_MS
      })
      if (agentSessionSendSubmission(settled?.value)?.dispatchState === 'accepted') {
        this.emit({ kind: 'turn-started', conversation: key })
      }
    } catch (error) {
      this.deps.log(`watching the opening of ${key.externalId} failed`, error)
    }
  }

  dispose(): void {
    this.subscribed?.release()
    this.subscribed = null
    this.listeners.clear()
    this.working.clear()
  }

  private async snapshot(): Promise<Snapshot | null> {
    const links = this.deps.state.links().filter(([, link]) => link.created)
    const host = links.length > 0 ? await this.deps.host() : null
    if (!host) {
      return null
    }
    this.attach(host)
    const conversations: Snapshot['conversations'] = []
    for (const [externalId, link] of links) {
      const journal = await readChatJournal(this.deps, link)
      const item = journal ? pendingPromptItem(journal.items) : null
      conversations.push({
        conversation: whatsappChatKeyOf(externalId),
        working: host.readStatusSummary(link.sessionId)?.status === 'working',
        started: journal ? chatStarted(journal.submissions) : false,
        prompt: item ? chatPrompt(item) : null
      })
    }
    return { kind: 'snapshot', conversations }
  }

  private status(event: AgentSessionStatusEvent): void {
    const sessions =
      event.type === 'snapshot' ? event.sessions : event.type === 'status' ? [event.session] : []
    for (const session of sessions) {
      const externalId = this.deps.state.chatOfSession(session.sessionId)
      if (!externalId) {
        continue
      }
      const working = session.status === 'working'
      if (working && this.working.get(session.sessionId) !== true) {
        this.emit({
          kind: 'turn-started',
          conversation: whatsappChatKeyOf(externalId)
        })
      }
      this.working.set(session.sessionId, working)
    }
  }

  private async completion(
    host: WhatsappChatHost,
    event: AgentSessionTurnCompletionEvent
  ): Promise<void> {
    if (event.type === 'end') {
      return
    }
    const sessionId = event.type === 'prompt' ? event.prompt.sessionId : event.completion.sessionId
    const externalId = this.deps.state.chatOfSession(sessionId)
    if (!externalId) {
      return
    }
    const conversation = whatsappChatKeyOf(externalId)
    try {
      const journal = await host.journalSnapshot(sessionId)
      if (event.type === 'prompt') {
        const item = pendingPromptItem(journal.items, event.prompt.promptId)
        if (item) {
          this.emit({ kind: 'prompt', conversation, prompt: chatPrompt(item) })
        }
        return
      }
      const { completion } = event
      const { startedAt, reply } = turnReply(journal.items, completion.turnId)
      const text = reply || (completion.outcome === 'failure' ? FAILED_TURN_TEXT : '')
      this.emit({
        kind: 'turn-ended',
        conversation,
        turnId: startedAt,
        ...(text ? { lastAssistantMessage: text } : {})
      })
    } catch (error) {
      this.deps.log(`reading the turn of ${externalId} failed`, error)
    }
  }

  emit(event: WhatsappChatEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch (error) {
        this.deps.log('a group chat listener failed', error)
      }
    }
  }
}
