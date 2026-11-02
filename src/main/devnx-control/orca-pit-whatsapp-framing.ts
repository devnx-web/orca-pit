// Orca-Pit: makes sure a WhatsApp chat's opening rules (which group, clients are not orders, short
// replies, no deploy without a request) reached the agent. A start counts only once the agent
// takes a message of the chat. Without that in 45 s the opening goes again by `send`, once — unless
// the chat still holds it for an agent that is slow to start, which would only read it twice;
// still nothing, the group is told. A message to a chat that was never framed carries the rules
// before its text.
import type {
  WhatsappChatEvent,
  WhatsappChatKey,
  WhatsappDelivery
} from './orca-pit-whatsapp-chat-types'
import type { WhatsappBridgeState } from './orca-pit-whatsapp-state'

export type WhatsappFramingDeps = {
  conversations: {
    send: (key: WhatsappChatKey, deliveryId: string, text: string) => Promise<WhatsappDelivery>
    openingHeld: (key: WhatsappChatKey) => Promise<boolean>
  }
  state: WhatsappBridgeState
  /** Resolves 'timeout' after the delay. */
  wait: (ms: number) => Promise<'timeout'>
  log: (message: string, error?: unknown) => void
  flush: () => Promise<void>
}

// Why 45 s: a cold chat program with an update to apply takes 20-30 s before it reads input.
export const START_CONFIRM_MS = 45_000
const NO_ANSWER_TEXT =
  'O agente não respondeu ao abrir o chat. Veja o chat do grupo no Orca-Pit desta máquina, ou mande "@orca nova".'

export class WhatsappFraming {
  constructor(private readonly deps: WhatsappFramingDeps) {}

  isFramed(key: WhatsappChatKey): boolean {
    return this.deps.state.chat(key.externalId)?.framed === true
  }

  /** The text, with the opening rules before it when they never reached this chat. */
  withFrame(key: WhatsappChatKey, frame: string, text: string): string {
    return this.isFramed(key) ? text : `${frame}\n${text}`
  }

  /** A turn of the chat began (or is running): its opening was read. */
  observe(event: WhatsappChatEvent): void {
    if (event.kind === 'snapshot') {
      for (const conversation of event.conversations) {
        if (conversation.working || conversation.started) {
          this.markFramed(conversation.conversation)
        }
      }
    } else if (event.kind === 'turn-started' || event.kind === 'turn-ended') {
      this.markFramed(event.conversation)
    }
  }

  private markFramed(key: WhatsappChatKey): void {
    const chat = key.source === 'whatsapp' ? this.deps.state.chat(key.externalId) : null
    if (chat && chat.framed !== true) {
      this.deps.state.setChat(key.externalId, { ...chat, framed: true })
    }
  }

  /** After a start: resend the opening once if no turn begins, then tell the group. */
  async watchStart(
    key: WhatsappChatKey,
    groupId: number,
    deliveryId: string,
    prompt: string
  ): Promise<void> {
    try {
      await this.deps.wait(START_CONFIRM_MS)
      if (this.isFramed(key)) {
        return
      }
      const { conversations } = this.deps
      const held = await conversations.openingHeld(key)
      this.deps.log(
        held
          ? `chat ${key.externalId} still holds its opening for the agent; waiting once more`
          : `chat ${key.externalId} did not start its turn; sending the opening again`
      )
      const resent = held
        ? ({ outcome: 'accepted' } as const)
        : await conversations.send(key, `${deliveryId}:abertura`, prompt)
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
