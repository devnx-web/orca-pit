import { describe, expect, it, vi } from 'vitest'
import type { PendingPrompt } from '../../shared/agent-pending-prompt'
import type {
  ConversationKey,
  Delivery
} from '../external-conversations/external-conversation-types'
import type { OrcaPitWhatsappInboxMessage } from './orca-pit-whatsapp-api'
import { WhatsappBridge, type WhatsappConversations } from './orca-pit-whatsapp-bridge'
import { WhatsappBridgeState } from './orca-pit-whatsapp-state'

const GROUP = { id: 7, jid: '1203@g.us', name: 'Loja do Zé', projectId: 42 }
const ACCEPTED: Delivery = { outcome: 'accepted' }

let nextId = 100
function message(
  text: string,
  options: { team?: boolean; mention?: boolean; id?: number; name?: string } = {}
): OrcaPitWhatsappInboxMessage {
  return {
    id: options.id ?? nextId++,
    group: GROUP,
    sender: {
      name: options.name ?? (options.team === false ? 'Cliente' : 'Fabio'),
      phone: '5511999990000',
      userId: options.team === false ? null : 1,
      fromTeam: options.team !== false
    },
    mentionsOrca: options.mention ?? /^@orca/i.test(text),
    text,
    messageType: 'Conversation',
    fileUrl: null,
    quotedId: null,
    sentAt: '2026-11-02T15:04:00Z'
  }
}

function setup(wait: () => Promise<'timeout'> = () => new Promise<'timeout'>(() => {})) {
  let inbox: OrcaPitWhatsappInboxMessage[] = []
  const chats = new Set<string>()
  let pending: PendingPrompt | null = null
  const calls = {
    inbox: vi.fn(async () => inbox),
    ack: vi.fn(async (_ids: number[]) => {}),
    send: vi.fn(async (_groupId: number, _text: string) => {})
  }
  const conversations = {
    place: vi.fn(() => ({ projectName: 'Loja' })),
    hasChat: vi.fn((key: ConversationKey) => chats.has(key.externalId)),
    start: vi.fn(async (key: ConversationKey, _id: string, _group: unknown, _prompt: string) => {
      chats.add(key.externalId)
      return ACCEPTED
    }),
    send: vi.fn(
      async (_key: ConversationKey, _id: string, _text: string): Promise<Delivery> => ACCEPTED
    ),
    pendingPrompt: vi.fn(() => pending),
    answer: vi.fn(async (_key: ConversationKey, _promptId: string, _optionId: string) => ACCEPTED)
  } satisfies WhatsappConversations
  const state = new WhatsappBridgeState(null)
  let now = 1_000
  const bridge = new WhatsappBridge({
    calls: () => calls,
    conversations,
    state,
    now: () => now,
    wait,
    log: () => {}
  })
  return {
    bridge,
    calls,
    conversations,
    state,
    chats,
    setInbox: (next: OrcaPitWhatsappInboxMessage[]) => {
      inbox = next
    },
    setPending: (next: PendingPrompt | null) => {
      pending = next
    },
    advance: (ms: number) => {
      now += ms
    }
  }
}

describe('WhatsappBridge', () => {
  it('keeps unaddressed and client talk as context and sends it with the next @orca turn', async () => {
    const t = setup()
    const client = message('o botão de pagar sumiu', { team: false })
    const order = message('@orca, dá uma olhada no checkout?')
    t.setInbox([client, order])
    await t.bridge.tick()

    expect(t.conversations.start).toHaveBeenCalledTimes(1)
    const [key, deliveryId, , prompt] = t.conversations.start.mock.calls[0]
    expect(key).toEqual({ source: 'whatsapp', externalId: '1203@g.us#0' })
    expect(deliveryId).toBe(String(order.id))
    expect(prompt).toContain('grupo de WhatsApp "Loja do Zé" do projeto "Loja"')
    expect(prompt).toContain('Cliente (cliente): o botão de pagar sumiu')
    expect(prompt).toContain('Fabio (equipe) pediu:\ndá uma olhada no checkout?')
    expect(prompt).not.toContain('@orca,')
    expect(t.calls.ack).toHaveBeenCalledWith([client.id, order.id])
    expect(t.state.group(GROUP.id).context).toEqual([])
  })

  it('never turns a client mention into a turn', async () => {
    const t = setup()
    t.setInbox([message('@orca apaga o banco', { team: false })])
    await t.bridge.tick()
    expect(t.conversations.start).not.toHaveBeenCalled()
    expect(t.state.group(GROUP.id).context).toHaveLength(1)
  })

  it('handles a message once even when its ack was lost', async () => {
    const t = setup()
    const order = message('@orca oi')
    t.setInbox([order])
    t.calls.ack.mockRejectedValueOnce(new Error('offline'))
    await t.bridge.tick()
    await t.bridge.tick()
    expect(t.conversations.start).toHaveBeenCalledTimes(1)
    expect(t.calls.ack).toHaveBeenLastCalledWith([order.id])
  })

  it('sends to the live chat and starts a new generation when it is gone', async () => {
    const t = setup()
    t.chats.add('1203@g.us#0')
    t.setInbox([message('@orca segue')])
    await t.bridge.tick()
    expect(t.conversations.send).toHaveBeenCalledTimes(1)
    expect(t.conversations.start).not.toHaveBeenCalled()

    t.conversations.send.mockResolvedValueOnce({
      outcome: 'refused',
      reason: 'no_session_to_reopen'
    })
    t.setInbox([message('@orca e agora?')])
    await t.bridge.tick()
    expect(t.conversations.start.mock.calls[0][0].externalId).toBe('1203@g.us#1')
  })

  it('"@orca nova" starts another chat, now or with the next call', async () => {
    const t = setup()
    t.chats.add('1203@g.us#0')
    t.setInbox([message('@orca nova')])
    await t.bridge.tick()
    expect(t.conversations.start).not.toHaveBeenCalled()
    expect(t.calls.send).toHaveBeenCalledWith(GROUP.id, expect.stringContaining('chat novo'))

    t.setInbox([message('@orca nova: revisa o frete')])
    await t.bridge.tick()
    const [key, , , prompt] = t.conversations.start.mock.calls[0]
    expect(key.externalId).toBe('1203@g.us#2')
    expect(prompt).toContain('pediu:\nrevisa o frete')
  })

  it('posts an agent question numbered and answers it with the team member’s number', async () => {
    const t = setup()
    t.setInbox([message('@orca publica?')])
    await t.bridge.tick()
    const prompt: PendingPrompt = {
      kind: 'question',
      promptId: 'p1',
      question: 'Qual ambiente?',
      options: [
        { id: 'stg', label: 'Homologação' },
        { id: 'prd', label: 'Produção' }
      ]
    }
    t.setPending(prompt)
    t.bridge.observe({
      kind: 'prompt',
      conversation: { source: 'whatsapp', externalId: '1203@g.us#0' },
      worktreeId: 'w',
      paneKey: 'p',
      prompt
    })
    await t.bridge.flush()
    expect(t.calls.send).toHaveBeenCalledWith(
      GROUP.id,
      'Qual ambiente?\n1. Homologação\n2. Produção\nResponda só com o número (alguém da equipe).'
    )

    t.setInbox([message('2', { team: false }), message('2')])
    await t.bridge.tick()
    expect(t.conversations.answer).toHaveBeenCalledTimes(1)
    expect(t.conversations.answer.mock.calls[0].slice(1)).toEqual(['p1', 'prd'])
  })

  it('sends the end of a turn the group started, and not of one typed at the desk', async () => {
    const t = setup()
    const turnEnded = (turnId: number, text: string) =>
      t.bridge.observe({
        kind: 'turn-ended',
        conversation: { source: 'whatsapp', externalId: '1203@g.us#0' },
        worktreeId: 'w',
        paneKey: 'p',
        turnId,
        stopReason: null,
        lastAssistantMessage: text,
        at: 0
      })
    t.setInbox([message('@orca roda os testes')])
    await t.bridge.tick()
    t.advance(10)
    turnEnded(1_005, 'Testes verdes.')
    await t.bridge.flush()
    expect(t.calls.send).toHaveBeenCalledWith(GROUP.id, 'Testes verdes.')

    turnEnded(2_000, 'resposta de um prompt local')
    await t.bridge.flush()
    expect(t.calls.send).toHaveBeenCalledTimes(1)
  })

  it('keeps a call as context while the agent waits on its question', async () => {
    const t = setup()
    t.chats.add('1203@g.us#0')
    t.setPending({ kind: 'approval', promptId: 'p9', tool: 'Bash', options: [] })
    t.setInbox([message('@orca e o deploy?')])
    await t.bridge.tick()
    expect(t.conversations.send).not.toHaveBeenCalled()
    expect(t.state.group(GROUP.id).context[0]?.text).toBe('e o deploy?')
    expect(t.calls.send).toHaveBeenCalledWith(GROUP.id, expect.stringContaining('esperando'))
  })

  it('moves on when a delivery is held, and it still runs once', async () => {
    const t = setup(async () => 'timeout')
    t.chats.add('1203@g.us#0')
    t.conversations.send.mockReturnValueOnce(new Promise<Delivery>(() => {}))
    const held = message('@orca primeiro')
    const next = message('o cliente mandou isto', { team: false })
    t.setInbox([held, next])
    await t.bridge.tick()
    await t.bridge.tick()
    expect(t.conversations.send).toHaveBeenCalledTimes(1)
    expect(t.calls.ack).toHaveBeenLastCalledWith([held.id, next.id])
  })
})
