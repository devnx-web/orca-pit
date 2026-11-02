// Orca-Pit: the WhatsApp bridge (contrato-whatsapp v1). It reads this machine's inbox in the
// Control in order and turns each message into one of three things: a turn of the group's chat
// (someone of the team called "@orca"), an answer to the agent's question (the team replied with
// an option number) or context for the next turn (everything else, clients included). A message
// is acknowledged only after its effect is saved here, and handled ids are remembered, so none is
// lost or run twice. The agent's answer at the end of each turn goes back to the group.
import type {
  OrcaPitWhatsappInboxMessage,
  OrcaPitWhatsappMachineCalls
} from './orca-pit-whatsapp-api'
import {
  refusalText,
  type WhatsappChatEvent,
  type WhatsappChatKey,
  type WhatsappChatRefusal,
  type WhatsappDelivery,
  type WhatsappInboxGroup
} from './orca-pit-whatsapp-chat-types'
import { WhatsappFraming } from './orca-pit-whatsapp-framing'
import { WhatsappReplies, type WhatsappPromptPort } from './orca-pit-whatsapp-replies'
import { MAX_CONTEXT_LINES, type WhatsappBridgeState } from './orca-pit-whatsapp-state'
import {
  initialPrompt,
  messageBody,
  parseNewChat,
  parseOptionNumber,
  senderName,
  sentAtMs,
  stripOrcaMention,
  turnText
} from './orca-pit-whatsapp-text'

export type { WhatsappInboxGroup }

/** The group's chat on this machine: a native Orca chat (`orca-pit-whatsapp-chats.ts`). */
export type WhatsappConversations = WhatsappPromptPort & {
  /** Where the group's chat runs here; null when no Orca project here is linked to its project. */
  place: (group: WhatsappInboxGroup) => { projectName: string } | null
  hasChat: (key: WhatsappChatKey) => boolean
  start: (
    key: WhatsappChatKey,
    deliveryId: string,
    group: WhatsappInboxGroup,
    prompt: string
  ) => Promise<WhatsappDelivery>
  send: (key: WhatsappChatKey, deliveryId: string, text: string) => Promise<WhatsappDelivery>
  /** The chat still holds its opening for an agent that has not taken it. */
  openingHeld: (key: WhatsappChatKey) => Promise<boolean>
}

export type WhatsappBridgeDeps = {
  /** This machine's Control calls; null while signed out or not approved. */
  calls: () => OrcaPitWhatsappMachineCalls | null
  conversations: WhatsappConversations
  state: WhatsappBridgeState
  now: () => number
  /** Resolves 'timeout' after the delay (unref'd in the app). */
  wait: (ms: number) => Promise<'timeout'>
  log?: (message: string, error?: unknown) => void
}

// The Control answers at most this many per call; a full page means more are waiting.
const INBOX_PAGE = 100
// A chat that is gone for good: a new generation starts instead.
const LOST_CHAT = new Set<WhatsappChatRefusal>(['chat_lost'])

export function whatsappChatKey(jid: string, generation: number): WhatsappChatKey {
  return { source: 'whatsapp', externalId: `${jid}#${generation}` }
}

// Why 20 s: a launch with a new worktree usually publishes by then; later ones settle in the background.
const DELIVERY_WAIT_MS = 20_000
const WAITING_TEXT =
  'O agente está esperando a resposta da pergunta acima. Responda com o número; esta mensagem fica como contexto.'

function failureText(reason: WhatsappChatRefusal): string {
  return `Não consegui passar a mensagem ao agente: ${refusalText(reason)}. Veja o Orca-Pit nesta máquina.`
}

export class WhatsappBridge {
  private running: Promise<void> | null = null
  private again = false
  private readonly replies: WhatsappReplies
  private readonly framing: WhatsappFraming
  private readonly log: (message: string, error?: unknown) => void

  constructor(private readonly deps: WhatsappBridgeDeps) {
    this.log = deps.log ?? ((text, cause) => console.warn(`[orca-pit] whatsapp: ${text}`, cause))
    this.replies = new WhatsappReplies({ ...deps, log: this.log })
    this.framing = new WhatsappFraming({
      ...deps,
      log: this.log,
      flush: () => this.flush()
    })
  }

  /** The seam's watch: turns beginning, questions and finished turns of the WhatsApp chats. */
  observe(event: WhatsappChatEvent): void {
    this.framing.observe(event)
    this.replies.observe(event)
  }

  /** Sends the replies the Control has not taken yet. */
  flush(): Promise<void> {
    return this.replies.flush()
  }

  /** One inbox round now; a wake during a round runs another right after it. */
  tick(): Promise<void> {
    if (this.running) {
      this.again = true
      return this.running
    }
    this.running = (async () => {
      try {
        do {
          this.again = false
          await this.round()
        } while (this.again)
      } catch (error) {
        this.log('inbox round failed', error)
      } finally {
        this.running = null
      }
    })()
    return this.running
  }

  private async round(): Promise<void> {
    const calls = this.deps.calls()
    if (!calls) {
      return
    }
    await this.flush()
    const messages = await calls.inbox()
    const handled: number[] = []
    for (const message of messages) {
      if (!this.deps.state.isProcessed(message.id)) {
        try {
          await this.handle(message)
        } catch (error) {
          // A message that keeps failing must not hold the inbox; its text stays as context.
          this.log(`message ${message.id} failed`, error)
          this.remember(message, message.text ?? '')
        }
        this.deps.state.markProcessed(message.id)
      }
      handled.push(message.id)
    }
    if (handled.length > 0) {
      await calls.ack(handled)
    }
    await this.flush()
    if (messages.length >= INBOX_PAGE) {
      this.again = true
    }
  }

  private async handle(message: OrcaPitWhatsappInboxMessage): Promise<void> {
    const text = message.text ?? ''
    if (message.sender.fromTeam) {
      const option = parseOptionNumber(text)
      if (option !== null && (await this.replies.answerPrompt(message.group.id, option))) {
        return
      }
      if (message.mentionsOrca) {
        await this.turn(message, stripOrcaMention(text))
        return
      }
    }
    // Clients and unaddressed talk are only ever context: never an order to the agent.
    this.remember(message, text)
  }

  private remember(message: OrcaPitWhatsappInboxMessage, text: string): void {
    this.deps.state.updateGroup(message.group.id, (group) =>
      group.context.some((line) => line.id === message.id)
        ? group
        : {
            ...group,
            context: [
              ...group.context,
              {
                id: message.id,
                at: sentAtMs(message, this.deps.now()),
                name: senderName(message),
                fromTeam: message.sender.fromTeam,
                text: messageBody(message, text)
              }
            ].slice(-MAX_CONTEXT_LINES)
          }
    )
  }

  private async turn(message: OrcaPitWhatsappInboxMessage, asked: string): Promise<void> {
    const { group } = message
    const { state, conversations } = this.deps
    let body = asked
    const fresh = parseNewChat(asked)
    if (fresh) {
      state.updateGroup(group.id, (current) => {
        const { announced: _dropped, ...rest } = current
        return { ...rest, generation: current.generation + 1 }
      })
      if (!fresh.rest) {
        state.enqueue(group.id, 'Certo: a próxima mensagem com @orca começa um chat novo.')
        return
      }
      body = fresh.rest
    }
    const place = conversations.place(group)
    if (!place) {
      this.remember(message, asked)
      state.enqueue(
        group.id,
        'Este grupo está ligado a um projeto que não está aberto no Orca-Pit desta máquina. Vincule o grupo nas configurações do projeto.'
      )
      return
    }
    const live = whatsappChatKey(group.jid, state.group(group.id).generation)
    if (conversations.hasChat(live) && (await conversations.pendingPrompt(live))) {
      // The agent waits on its question; a new message would queue behind it, unread.
      this.remember(message, asked)
      state.enqueue(group.id, WAITING_TEXT)
      return
    }
    const text = turnText({
      context: state.group(group.id).context,
      name: senderName(message),
      at: sentAtMs(message, this.deps.now()),
      body: messageBody(message, body)
    })
    const settled = (delivery: WhatsappDelivery): void => {
      if (delivery.outcome === 'refused') {
        this.remember(message, asked)
        state.enqueue(group.id, failureText(delivery.reason))
        void this.flush()
      }
    }
    const delivering = this.deliver(group, String(message.id), text, place.projectName).catch(
      (error: unknown): WhatsappDelivery => {
        this.log(`delivery of message ${message.id} failed`, error)
        return { outcome: 'refused', reason: 'not_delivered' }
      }
    )
    // Why not wait it out: a write can sit behind an approval the group answers in a later
    // message. The delivery receipt already holds this id, so it never runs twice.
    const outcome = await Promise.race([delivering, this.deps.wait(DELIVERY_WAIT_MS)])
    if (outcome === 'timeout') {
      void delivering.then(settled)
    } else {
      settled(outcome)
      if (outcome.outcome === 'refused') {
        return
      }
    }
    // Delivered (or on its way): the context went with it.
    state.updateGroup(group.id, (current) => ({ ...current, context: [] }))
  }

  /** Sends to the live chat; starts one when there is none or it is gone for good. */
  private async deliver(
    group: WhatsappInboxGroup,
    deliveryId: string,
    text: string,
    projectName: string
  ): Promise<WhatsappDelivery> {
    const { state, conversations } = this.deps
    let key = whatsappChatKey(group.jid, state.group(group.id).generation)
    const frame = initialPrompt({ groupName: group.name, projectName })
    if (conversations.hasChat(key)) {
      // A chat whose opening never reached the agent gets it now, before the message.
      const framed = this.framing.withFrame(key, frame, text)
      const sent = await this.owed(key, group.id, () => conversations.send(key, deliveryId, framed))
      if (sent.outcome !== 'refused' || !LOST_CHAT.has(sent.reason)) {
        return sent
      }
      state.updateGroup(group.id, (current) => ({
        ...current,
        generation: current.generation + 1
      }))
      key = whatsappChatKey(group.jid, state.group(group.id).generation)
    }
    const prompt = `${frame}\n${text}`
    const startKey = key
    const started = await this.owed(startKey, group.id, () =>
      conversations.start(startKey, deliveryId, group, prompt)
    )
    if (started.outcome !== 'refused') {
      void this.framing.watchStart(startKey, group.id, deliveryId, prompt)
    }
    return started
  }

  /** The chat owes the group an answer from before the write, so a fast turn end is not missed. */
  private async owed(
    key: WhatsappChatKey,
    groupId: number,
    write: () => Promise<WhatsappDelivery>
  ): Promise<WhatsappDelivery> {
    const { state } = this.deps
    const before = state.chat(key.externalId)
    state.setChat(key.externalId, {
      ...before,
      groupId,
      awaitingSince: this.deps.now()
    })
    const delivery = await write()
    if (delivery.outcome === 'refused') {
      state.setChat(key.externalId, before ?? { groupId, awaitingSince: null })
    }
    return delivery
  }
}
