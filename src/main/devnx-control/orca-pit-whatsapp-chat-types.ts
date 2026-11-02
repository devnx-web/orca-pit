// Orca-Pit: the words the WhatsApp bridge and the group's Orca chat speak. Each group's
// conversation is a native Orca chat (the structured session the "new chat" tab opens), never an
// agent's terminal; these types are what the bridge needs of it and nothing of the chat host.
import type { PendingPrompt } from '../../shared/agent-pending-prompt'
import type { OrcaPitWhatsappInboxMessage } from './orca-pit-whatsapp-api'

export type WhatsappInboxGroup = OrcaPitWhatsappInboxMessage['group']

/** One chat of a group: `<group jid>#<generation>`; "@orca nova" moves to the next generation. */
export type WhatsappChatKey = { source: 'whatsapp'; externalId: string }

export type WhatsappChatRefusal =
  /** This machine cannot run an Orca chat (no chat host, chat program missing, remote or WSL). */
  | 'chat_unavailable'
  /** The chat is gone for good (deleted, or its workspace removed): a new one starts instead. */
  | 'chat_lost'
  /** The chat is there but did not take the message; it stays the group's chat. */
  | 'not_delivered'
  | 'prompt_not_pending'
  | 'option_not_offered'

/** `accepted`: the chat holds the message (sent, or queued behind the running turn). */
export type WhatsappDelivery =
  | { outcome: 'accepted' }
  | { outcome: 'refused'; reason: WhatsappChatRefusal }

export type WhatsappChatEvent =
  | {
      kind: 'snapshot'
      conversations: {
        conversation: WhatsappChatKey
        working: boolean
        /** The agent has taken a message of this chat. */
        started: boolean
        prompt: PendingPrompt | null
      }[]
    }
  | { kind: 'prompt'; conversation: WhatsappChatKey; prompt: PendingPrompt }
  /** The agent took a message: a turn began. */
  | { kind: 'turn-started'; conversation: WhatsappChatKey }
  | {
      kind: 'turn-ended'
      conversation: WhatsappChatKey
      /** When the ended turn began (epoch ms); null when the chat cannot tell. */
      turnId: number | null
      lastAssistantMessage?: string
    }

export type WhatsappChatListener = (event: WhatsappChatEvent) => void

export function refusedDelivery(reason: WhatsappChatRefusal): WhatsappDelivery {
  return { outcome: 'refused', reason }
}

/** The refusal as the group reads it. */
export function refusalText(reason: WhatsappChatRefusal): string {
  switch (reason) {
    case 'chat_unavailable':
      return 'o chat do Orca está indisponível nesta máquina'
    case 'chat_lost':
      return 'o chat do grupo não existe mais'
    case 'not_delivered':
      return 'o chat não recebeu a mensagem'
    case 'prompt_not_pending':
      return 'a pergunta já não está pendente'
    case 'option_not_offered':
      return 'essa opção não existe'
  }
}
