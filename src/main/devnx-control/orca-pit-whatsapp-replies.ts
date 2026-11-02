// Orca-Pit: the agent's side of a WhatsApp chat, back to its group: the answer at the end of each
// turn the group started, its questions as numbered options (and the team's number as the answer),
// and the queue that holds what the Control has not taken yet, so a short outage loses nothing.
import type { PendingPrompt } from '../../shared/agent-pending-prompt'
import type { OrcaPitWhatsappMachineCalls } from './orca-pit-whatsapp-api'
import type {
  WhatsappChatEvent,
  WhatsappChatKey,
  WhatsappDelivery
} from './orca-pit-whatsapp-chat-types'
import type { WhatsappBridgeState } from './orca-pit-whatsapp-state'
import { clipReply, promptMessage } from './orca-pit-whatsapp-text'

/** The chat's pending question and its answer. */
export type WhatsappPromptPort = {
  pendingPrompt: (key: WhatsappChatKey) => Promise<PendingPrompt | null>
  answer: (key: WhatsappChatKey, promptId: string, optionId: string) => Promise<WhatsappDelivery>
}

export type WhatsappRepliesDeps = {
  calls: () => OrcaPitWhatsappMachineCalls | null
  conversations: WhatsappPromptPort
  state: WhatsappBridgeState
  log: (message: string, error?: unknown) => void
}

// Why 8: about eight minutes of retries at the 60 s beat before a reply loses its point.
const MAX_SEND_ATTEMPTS = 8

export class WhatsappReplies {
  private flushing: Promise<void> | null = null

  constructor(private readonly deps: WhatsappRepliesDeps) {}

  /** The chats' watch: questions and finished turns of the WhatsApp chats. */
  observe(event: WhatsappChatEvent): void {
    if (event.kind === 'snapshot') {
      for (const conversation of event.conversations) {
        if (conversation.prompt) {
          this.announce(conversation.conversation, conversation.prompt)
        }
      }
    } else if (event.kind === 'prompt') {
      this.announce(event.conversation, event.prompt)
    } else if (event.kind === 'turn-ended') {
      this.turnEnded(event)
    }
    void this.flush()
  }

  /** A team member's option number for the question the group was shown; false when none waits. */
  async answerPrompt(groupId: number, option: number): Promise<boolean> {
    const { state, conversations } = this.deps
    const announced = state.group(groupId).announced
    if (!announced) {
      return false
    }
    const key: WhatsappChatKey = {
      source: 'whatsapp',
      externalId: announced.externalId
    }
    const pending = await conversations.pendingPrompt(key)
    if (!pending || pending.promptId !== announced.promptId || pending.kind === 'unsupported') {
      return false
    }
    const chosen = pending.options[option - 1]
    if (!chosen) {
      state.enqueue(
        groupId,
        `Não há opção ${option}. Responda com um número de 1 a ${pending.options.length}.`
      )
      return true
    }
    const answered = await conversations.answer(key, pending.promptId, chosen.id)
    if (answered.outcome === 'refused') {
      return false
    }
    state.updateGroup(groupId, (current) => {
      const { announced: _answered, ...rest } = current
      return rest
    })
    return true
  }

  private announce(conversation: WhatsappChatKey, prompt: PendingPrompt): void {
    if (conversation.source !== 'whatsapp') {
      return
    }
    const { state } = this.deps
    const chat = state.chat(conversation.externalId)
    const announced = chat ? state.group(chat.groupId).announced : undefined
    if (!chat || announced?.promptId === prompt.promptId) {
      return
    }
    state.updateGroup(chat.groupId, (group) => ({
      ...group,
      announced: {
        externalId: conversation.externalId,
        promptId: prompt.promptId
      }
    }))
    state.enqueue(chat.groupId, promptMessage(prompt))
  }

  private turnEnded(event: Extract<WhatsappChatEvent, { kind: 'turn-ended' }>): void {
    if (event.conversation.source !== 'whatsapp') {
      return
    }
    const { state } = this.deps
    const chat = state.chat(event.conversation.externalId)
    if (!chat || chat.awaitingSince === null) {
      return
    }
    // A turn that began before the group's message may have left it for the next turn.
    const settled = event.turnId === null || event.turnId >= chat.awaitingSince
    if (settled) {
      state.setChat(event.conversation.externalId, {
        ...chat,
        awaitingSince: null
      })
    }
    const reply = event.lastAssistantMessage?.trim()
    if (reply) {
      state.enqueue(chat.groupId, clipReply(reply))
    }
  }

  /** Sends the queued replies in order; one that keeps failing is dropped after a few rounds. */
  flush(): Promise<void> {
    this.flushing ??= this.sendQueued().finally(() => {
      this.flushing = null
    })
    return this.flushing
  }

  private async sendQueued(): Promise<void> {
    const { state } = this.deps
    for (let item = state.outbox()[0]; item; item = state.outbox()[0]) {
      const calls = this.deps.calls()
      if (!calls) {
        return
      }
      try {
        await calls.send(item.groupId, item.text)
        state.settleFirst(true)
      } catch (error) {
        const giveUp = item.attempts + 1 >= MAX_SEND_ATTEMPTS
        this.deps.log(giveUp ? 'reply dropped after retries' : 'reply not sent yet', error)
        state.settleFirst(giveUp)
        if (!giveUp) {
          return
        }
      }
    }
  }
}
