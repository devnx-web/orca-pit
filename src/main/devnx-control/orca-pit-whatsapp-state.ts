// Orca-Pit: what the WhatsApp bridge must remember across restarts, in one 0600 JSON file: the
// messages already handled (so an unacknowledged one never runs twice), the group talk kept as
// context for the next turn, each group's chat generation (`@orca nova`), which chats owe the
// group an answer, and replies the Control has not taken yet.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { isRecord } from './devnx-control-http'

export type WhatsappContextLine = {
  /** The Control's message id, so a retried message is not kept twice. */
  id: number
  /** Epoch ms of the message. */
  at: number
  name: string
  fromTeam: boolean
  text: string
}

export type WhatsappGroupState = {
  generation: number
  context: WhatsappContextLine[]
  /** The Orca project chosen for this group in that project's settings on this host. */
  repoId?: string
  /** The agent question last sent to the group, so it is sent once and a number answers it. */
  announced?: { externalId: string; promptId: string }
}

export type WhatsappChatState = {
  groupId: number
  /**
   * When the group's last message reached the agent, until a turn that began after it ends: the
   * answers of the turns ending meanwhile go to the group. Null when nothing is owed.
   */
  awaitingSince: number | null
}

export type WhatsappOutboxItem = { groupId: number; text: string; attempts: number }

export type WhatsappStateData = {
  processed: number[]
  groups: Record<string, WhatsappGroupState>
  chats: Record<string, WhatsappChatState>
  outbox: WhatsappOutboxItem[]
}

// Why 5000: far more than one inbox page (100); old ids are acknowledged and never come back.
const MAX_PROCESSED = 5000
// Why 40 lines: enough for a busy hour in a group, small enough to keep each turn readable.
export const MAX_CONTEXT_LINES = 40
// Why 50: a Control outage of a few hours with an active chat; older replies lose their point.
const MAX_OUTBOX = 50

function emptyState(): WhatsappStateData {
  return { processed: [], groups: {}, chats: {}, outbox: [] }
}

function parseState(value: unknown): WhatsappStateData {
  if (!isRecord(value)) {
    return emptyState()
  }
  const processed = Array.isArray(value.processed)
    ? value.processed.filter((entry): entry is number => Number.isInteger(entry))
    : []
  const groups = isRecord(value.groups) ? value.groups : {}
  const chats = isRecord(value.chats) ? value.chats : {}
  return {
    processed,
    groups: Object.fromEntries(
      Object.entries(groups).flatMap(([key, raw]) => {
        if (!isRecord(raw)) {
          return []
        }
        const context = Array.isArray(raw.context)
          ? raw.context.filter(
              (line): line is WhatsappContextLine =>
                isRecord(line) &&
                Number.isInteger(line.id) &&
                typeof line.at === 'number' &&
                typeof line.name === 'string' &&
                typeof line.text === 'string' &&
                typeof line.fromTeam === 'boolean'
            )
          : []
        const group: WhatsappGroupState = {
          generation: Number.isInteger(raw.generation) ? Number(raw.generation) : 0,
          context
        }
        if (typeof raw.repoId === 'string' && raw.repoId) {
          group.repoId = raw.repoId
        }
        const announced = isRecord(raw.announced) ? raw.announced : null
        if (
          announced &&
          typeof announced.externalId === 'string' &&
          typeof announced.promptId === 'string'
        ) {
          group.announced = { externalId: announced.externalId, promptId: announced.promptId }
        }
        return [[key, group]]
      })
    ),
    chats: Object.fromEntries(
      Object.entries(chats).flatMap(([key, raw]) =>
        isRecord(raw) && Number.isInteger(raw.groupId)
          ? [
              [
                key,
                {
                  groupId: Number(raw.groupId),
                  awaitingSince: typeof raw.awaitingSince === 'number' ? raw.awaitingSince : null
                }
              ]
            ]
          : []
      )
    ),
    outbox: Array.isArray(value.outbox)
      ? value.outbox.filter(
          (item): item is WhatsappOutboxItem =>
            isRecord(item) &&
            Number.isInteger(item.groupId) &&
            typeof item.text === 'string' &&
            typeof item.attempts === 'number'
        )
      : []
  }
}

/** Every change is written before it is acted on; null keeps it in memory (tests). */
export class WhatsappBridgeState {
  private data: WhatsappStateData

  constructor(private readonly filePath: string | null) {
    this.data = filePath ? this.read(filePath) : emptyState()
  }

  private read(filePath: string): WhatsappStateData {
    try {
      return parseState(JSON.parse(readFileSync(filePath, 'utf8')))
    } catch {
      return emptyState()
    }
  }

  private save(): void {
    if (!this.filePath) {
      return
    }
    mkdirSync(dirname(this.filePath), { recursive: true })
    // Write then rename, so a crash mid-write never leaves half a file that would forget everything.
    const temp = `${this.filePath}.tmp`
    writeFileSync(temp, `${JSON.stringify(this.data)}\n`, { mode: 0o600 })
    renameSync(temp, this.filePath)
  }

  group(groupId: number): WhatsappGroupState {
    return this.data.groups[String(groupId)] ?? { generation: 0, context: [] }
  }

  updateGroup(groupId: number, change: (group: WhatsappGroupState) => WhatsappGroupState): void {
    this.data.groups[String(groupId)] = change(this.group(groupId))
    this.save()
  }

  isProcessed(messageId: number): boolean {
    return this.data.processed.includes(messageId)
  }

  /** Marks the message handled, together with whatever the handling changed. */
  markProcessed(messageId: number): void {
    if (!this.data.processed.includes(messageId)) {
      this.data.processed.push(messageId)
      this.data.processed = this.data.processed.slice(-MAX_PROCESSED)
    }
    this.save()
  }

  chat(externalId: string): WhatsappChatState | null {
    return this.data.chats[externalId] ?? null
  }

  setChat(externalId: string, chat: WhatsappChatState): void {
    this.data.chats[externalId] = chat
    this.save()
  }

  outbox(): readonly WhatsappOutboxItem[] {
    return this.data.outbox
  }

  enqueue(groupId: number, text: string): void {
    this.data.outbox = [...this.data.outbox, { groupId, text, attempts: 0 }].slice(-MAX_OUTBOX)
    this.save()
  }

  /** The first item was sent (or given up on): drop it; otherwise count the failed attempt. */
  settleFirst(sent: boolean): void {
    const [first, ...rest] = this.data.outbox
    if (!first) {
      return
    }
    this.data.outbox = sent ? rest : [{ ...first, attempts: first.attempts + 1 }, ...rest]
    this.save()
  }
}
