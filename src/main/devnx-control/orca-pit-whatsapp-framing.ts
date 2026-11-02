// Orca-Pit: makes sure a WhatsApp chat's opening rules (which group, clients are not orders, short
// replies, no deploy without a request) reached the agent. A freshly opened Claude Code can drop
// the typed prompt (it updates itself on launch, for instance), so a start counts only once a turn
// begins. Without one in 45 s the opening goes again by `send`, once; still nothing, the group is
// told. A message to a chat that was never framed carries the rules before its text.
import type {
  ConversationEvent,
  ConversationSnapshot
} from '../external-conversations/external-conversation-events'
import type {
  ConversationKey,
  Delivery
} from '../external-conversations/external-conversation-types'
import type { WhatsappBridgeState } from './orca-pit-whatsapp-state'

export type WhatsappFramingDeps = {
  conversations: {
    send: (key: ConversationKey, deliveryId: string, text: string) => Promise<Delivery>
  }
  state: WhatsappBridgeState
  /** Resolves 'timeout' after the delay. */
  wait: (ms: number) => Promise<'timeout'>
  log: (message: string, error?: unknown) => void
  flush: () => Promise<void>
}

// Why 45 s: a cold Claude Code with an update to apply takes 20-30 s before it reads input.
export const START_CONFIRM_MS = 45_000
const NO_ANSWER_TEXT =
  'O agente não respondeu ao abrir o chat. Veja a aba do grupo no Orca-Pit desta máquina, ou mande "@orca nova".'

export class WhatsappFraming {
  constructor(private readonly deps: WhatsappFramingDeps) {}

  isFramed(key: ConversationKey): boolean {
    return this.deps.state.chat(key.externalId)?.framed === true
  }

  /** The text, with the opening rules before it when they never reached this chat. */
  withFrame(key: ConversationKey, frame: string, text: string): string {
    return this.isFramed(key) ? text : `${frame}\n${text}`
  }

  /** A turn of the chat began (or is running): its opening was read. */
  observe(event: ConversationSnapshot | ConversationEvent): void {
    if (event.kind === 'snapshot') {
      for (const conversation of event.conversations) {
        if (conversation.working || conversation.turnId !== null) {
          this.markFramed(conversation.conversation)
        }
      }
    } else if (event.kind === 'turn-started' || event.kind === 'turn-ended') {
      this.markFramed(event.conversation)
    }
  }

  private markFramed(key: ConversationKey): void {
    const chat = key.source === 'whatsapp' ? this.deps.state.chat(key.externalId) : null
    if (chat && chat.framed !== true) {
      this.deps.state.setChat(key.externalId, { ...chat, framed: true })
    }
  }

  /** After a start: resend the opening once if no turn begins, then tell the group. */
  async watchStart(
    key: ConversationKey,
    groupId: number,
    deliveryId: string,
    prompt: string
  ): Promise<void> {
    try {
      await this.deps.wait(START_CONFIRM_MS)
      if (this.isFramed(key)) {
        return
      }
      this.deps.log(`chat ${key.externalId} did not start its turn; sending the opening again`)
      const resent = await this.deps.conversations.send(key, `${deliveryId}:abertura`, prompt)
      if (resent.outcome !== 'refused') {
        await this.deps.wait(START_CONFIRM_MS)
        if (this.isFramed(key)) {
          return
        }
      }
      this.deps.state.enqueue(groupId, NO_ANSWER_TEXT)
      await this.deps.flush()
    } catch (error) {
      this.deps.log(`watching the start of ${key.externalId} failed`, error)
    }
  }
}
