import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  AgentJournalItemBody,
  AgentJournalRenderItem,
  AgentJournalSnapshot
} from '../../shared/agent-session-journal-types'
import { computeAgentSessionPayloadFingerprint } from '../../shared/agent-session-mutation-envelope'
import type {
  AgentSessionStatusEvent,
  AgentSessionTurnCompletionEvent
} from '../../shared/agent-session-wire'
import type { WhatsappChatEvent, WhatsappChatKey } from './orca-pit-whatsapp-chat-types'
import {
  WhatsappChats,
  type WhatsappChatCreate,
  type WhatsappChatCreated,
  type WhatsappChatHost,
  type WhatsappChatsDeps
} from './orca-pit-whatsapp-chats'
import { WhatsappBridgeState } from './orca-pit-whatsapp-state'

const sendAgentTurn = vi.hoisted(() => vi.fn())
vi.mock('../runtime/orchestration/send-agent-turn', () => ({ sendAgentTurn }))

const GROUP = { id: 7, jid: '1203@g.us', name: 'Loja do Zé', projectId: 42 }
const KEY: WhatsappChatKey = { source: 'whatsapp', externalId: '1203@g.us#0' }

let sequence = 0
function item(
  itemId: string,
  body: AgentJournalItemBody,
  turnItemId?: string
): AgentJournalRenderItem {
  sequence += 1
  return {
    itemId,
    revision: 3,
    sequence,
    observedAt: sequence,
    body,
    ...(turnItemId ? { turnScope: { kind: 'turn' as const, turnItemId } } : {})
  }
}
const said = (itemId: string, text: string, turnItemId: string) =>
  item(itemId, { kind: 'message', role: 'assistant', blocks: [{ type: 'text', text }] }, turnItemId)
const asked = (itemId: string) =>
  item(itemId, {
    kind: 'question',
    question: 'Qual ambiente?',
    options: [
      { id: 'stg', label: 'Homologação' },
      { id: 'prd', label: 'Produção' }
    ],
    resolution: {
      state: 'pending',
      selectedOptionId: null,
      resolvedBy: null,
      resolvedAt: null
    }
  })

function fakeHost() {
  let completions: ((event: AgentSessionTurnCompletionEvent) => void) | null = null
  let statuses: ((event: AgentSessionStatusEvent) => void) | null = null
  let journal: AgentJournalSnapshot = {
    sessionId: 's',
    cursor: { epoch: 'e', sequence: 0 },
    items: [],
    submissions: []
  }
  const host = {
    waitForSendSettlement: vi.fn(async () => ({
      value: {
        clientMessageId: 'm',
        submission: { dispatchState: 'accepted' }
      }
    })),
    respondToPrompt: vi.fn(async () => ({ ok: true, value: {} })),
    journalSnapshot: vi.fn(async () => journal),
    readStatusSummary: vi.fn((): { status: string } | undefined => undefined),
    subscribeTurnCompletions: vi.fn(
      (subscriber: { emit: (event: AgentSessionTurnCompletionEvent) => void }) => {
        completions = subscriber.emit
        return () => {}
      }
    ),
    subscribeStatus: vi.fn((subscriber: { emit: (event: AgentSessionStatusEvent) => void }) => {
      statuses = subscriber.emit
      return () => {}
    }),
    setUserConversationName: vi.fn(async () => ({
      name: GROUP.name,
      applied: true
    })),
    isSessionTabVisible: vi.fn(() => true),
    send: vi.fn(),
    deps: {
      store: {
        requireWritableRecord: vi.fn(() => ({ lease: { runtimeFence: 4 } }))
      }
    }
  }
  return {
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a fake of the calls this module makes.
    host: host as unknown as WhatsappChatHost,
    raw: host,
    setJournal: (next: Partial<AgentJournalSnapshot>) => {
      journal = { ...journal, ...next }
    },
    completion: (event: AgentSessionTurnCompletionEvent) => completions?.(event),
    status: (event: AgentSessionStatusEvent) => statuses?.(event)
  }
}

function setup() {
  const fake = fakeHost()
  const state = new WhatsappBridgeState(null)
  let minted = 0
  const deps = {
    state,
    host: vi.fn(async (): Promise<WhatsappChatHost | null> => fake.host),
    chatSupported: vi.fn(async (): Promise<boolean | null> => true),
    openWorkspace: vi.fn(async (): Promise<string | null> => 'wt-new'),
    workspaceExists: vi.fn(async () => true),
    createChat: vi.fn(async (_input: WhatsappChatCreate): Promise<WhatsappChatCreated> => ({
      ok: true
    })),
    showTab: vi.fn(async () => {}),
    legacyChat: vi.fn((): ReturnType<WhatsappChatsDeps['legacyChat']> => null),
    stopLegacyTerminal: vi.fn(async () => {}),
    mintOperationId: () => `op-${++minted}`,
    mintSessionId: () => `claude_session_${++minted}`,
    sleep: vi.fn(async () => {}),
    log: () => {}
  } satisfies WhatsappChatsDeps
  const chats = new WhatsappChats(deps)
  const events: WhatsappChatEvent[] = []
  chats.watch((event) => events.push(event))
  return { chats, deps, fake, state, events }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  sendAgentTurn.mockReset()
  sendAgentTurn.mockResolvedValue({
    kind: 'sent',
    clientMessageId: 'm',
    submission: undefined
  })
})

describe('WhatsappChats', () => {
  it('opens the group chat as an Orca chat in a workspace of its own, named after the group', async () => {
    const t = setup()
    expect(await t.chats.start(KEY, GROUP, 'regras\npedido')).toEqual({
      outcome: 'accepted'
    })

    expect(t.deps.openWorkspace).toHaveBeenCalledWith(GROUP, KEY.externalId, expect.any(Function))
    const [created] = t.deps.createChat.mock.calls[0]
    expect(created).toMatchObject({
      worktreeId: 'wt-new',
      text: 'regras\npedido'
    })
    expect(created.resumeProviderSessionId).toBeUndefined()
    expect(t.chats.hasChat(KEY)).toBe(true)
    expect(t.fake.raw.setUserConversationName).toHaveBeenCalledWith(
      created.sessionId,
      'Loja do Zé',
      'rename'
    )
    await settle()
    expect(t.events).toContainEqual({
      kind: 'turn-started',
      conversation: KEY
    })
  })

  it('refuses instead of opening a terminal when this machine cannot run a chat', async () => {
    const t = setup()
    t.deps.chatSupported.mockResolvedValueOnce(false)
    expect(await t.chats.start(KEY, GROUP, 'oi')).toEqual({
      outcome: 'refused',
      reason: 'chat_unavailable'
    })
    t.deps.host.mockResolvedValueOnce(null)
    expect(await t.chats.start(KEY, GROUP, 'oi')).toEqual({
      outcome: 'refused',
      reason: 'chat_unavailable'
    })
    t.deps.createChat.mockResolvedValueOnce({
      ok: false,
      code: 'structured_agent_session_unsupported',
      stage: 'prepare'
    })
    expect(await t.chats.start(KEY, GROUP, 'oi')).toEqual({
      outcome: 'refused',
      reason: 'chat_unavailable'
    })
    expect(t.chats.hasChat(KEY)).toBe(false)
  })

  it('retries a failed start in the workspace and with the ids it already has', async () => {
    const t = setup()
    t.deps.createChat.mockResolvedValueOnce({
      ok: false,
      code: 'agent_session_operation_unknown',
      stage: 'commit'
    })
    expect((await t.chats.start(KEY, GROUP, 'oi')).outcome).toBe('refused')
    await t.chats.start(KEY, GROUP, 'oi')
    expect(t.deps.openWorkspace).toHaveBeenCalledTimes(1)
    const [first, second] = t.deps.createChat.mock.calls.map(([input]) => input)
    expect(second).toEqual(first)
  })

  it('retries under new ids after a refusal the host recorded', async () => {
    const t = setup()
    t.deps.createChat.mockResolvedValueOnce({
      ok: false,
      code: 'agent_session_operation_invalid',
      stage: 'commit'
    })
    expect(await t.chats.start(KEY, GROUP, 'oi')).toEqual({
      outcome: 'refused',
      reason: 'not_delivered'
    })
    await t.chats.start(KEY, GROUP, 'oi')
    const [first, second] = t.deps.createChat.mock.calls.map(([input]) => input)
    expect(second.worktreeId).toBe(first.worktreeId)
    expect(second.sessionId).not.toBe(first.sessionId)
    expect(second.operationId).not.toBe(first.operationId)
  })

  it('opens a new workspace when the one kept for an unmade chat was removed', async () => {
    const t = setup()
    t.deps.legacyChat.mockReturnValue({
      worktreeId: 'wt-old',
      paneKey: 'p',
      providerSessionId: 'x'
    })
    t.deps.workspaceExists.mockResolvedValueOnce(false)
    await t.chats.start(KEY, GROUP, 'oi')
    expect(t.deps.openWorkspace).toHaveBeenCalledTimes(1)
    expect(t.deps.createChat.mock.calls[0][0]).toMatchObject({ worktreeId: 'wt-new' })
    expect(t.deps.createChat.mock.calls[0][0].resumeProviderSessionId).toBeUndefined()
  })

  it('moves an old terminal chat to an Orca chat that resumes the same agent session', async () => {
    const t = setup()
    t.deps.legacyChat.mockReturnValue({
      worktreeId: 'wt-old',
      paneKey: 'tab:leaf',
      providerSessionId: 'f6d94f7e-8531-4366-8b09-0020ef63e152'
    })
    t.deps.createChat.mockResolvedValueOnce({
      ok: false,
      code: 'agent_session_conflict',
      stage: 'prepare'
    })
    expect(await t.chats.start(KEY, GROUP, 'oi')).toEqual({
      outcome: 'accepted'
    })

    expect(t.deps.stopLegacyTerminal).toHaveBeenCalledWith('tab:leaf')
    expect(t.deps.openWorkspace).not.toHaveBeenCalled()
    expect(t.deps.createChat).toHaveBeenCalledTimes(2)
    expect(t.deps.createChat.mock.calls[1][0]).toMatchObject({
      worktreeId: 'wt-old',
      resumeProviderSessionId: 'f6d94f7e-8531-4366-8b09-0020ef63e152'
    })
  })

  it('starts fresh in the old workspace when the old session cannot be resumed', async () => {
    const t = setup()
    t.deps.legacyChat.mockReturnValue({
      worktreeId: 'wt-old',
      paneKey: 'p',
      providerSessionId: 'x'
    })
    t.deps.createChat.mockResolvedValueOnce({
      ok: false,
      code: 'agent_session_identity_required',
      stage: 'prepare'
    })
    expect(await t.chats.start(KEY, GROUP, 'oi')).toEqual({
      outcome: 'accepted'
    })
    const [resumed, fresh] = t.deps.createChat.mock.calls.map(([input]) => input)
    expect(fresh.resumeProviderSessionId).toBeUndefined()
    expect(fresh.worktreeId).toBe('wt-old')
    expect(fresh.sessionId).not.toBe(resumed.sessionId)
    expect(t.state.link(KEY.externalId)?.sessionId).toBe(fresh.sessionId)
  })

  describe('with a chat', () => {
    async function started() {
      const t = setup()
      await t.chats.start(KEY, GROUP, 'oi')
      const sessionId = t.state.link(KEY.externalId)!.sessionId
      return { ...t, sessionId }
    }

    it('sends a message as a queued user turn, once per delivery id', async () => {
      const t = await started()
      expect(await t.chats.send(KEY, '101', 'segue')).toEqual({
        outcome: 'accepted'
      })
      await t.chats.send(KEY, '101', 'segue')
      const [first, again] = sendAgentTurn.mock.calls.map(([send]) => send)
      expect(first).toMatchObject({
        kind: 'structured-session',
        sessionId: t.sessionId,
        turn: {
          delivery: 'queue',
          expectedRuntimeFence: 4,
          body: {
            kind: 'message',
            role: 'user',
            blocks: [{ type: 'text', text: 'segue' }]
          }
        }
      })
      expect(again.turn.operationId).toBe(first.turn.operationId)
    })

    it('brings a closed chat tab back before the agent works', async () => {
      const t = await started()
      t.fake.raw.isSessionTabVisible.mockReturnValue(false)
      await t.chats.send(KEY, '101', 'segue')
      expect(t.deps.showTab).toHaveBeenCalledWith(t.sessionId)
    })

    it('reports a chat whose workspace or record is gone as lost', async () => {
      const t = await started()
      t.deps.workspaceExists.mockResolvedValueOnce(false)
      expect(await t.chats.send(KEY, '1', 'a')).toEqual({
        outcome: 'refused',
        reason: 'chat_lost'
      })
      t.fake.raw.deps.store.requireWritableRecord.mockImplementationOnce(() => {
        throw new Error('missing')
      })
      expect(await t.chats.send(KEY, '2', 'b')).toEqual({
        outcome: 'refused',
        reason: 'chat_lost'
      })
      sendAgentTurn.mockResolvedValueOnce({
        kind: 'refused',
        refusal: { code: 'agent_session_identity_required', message: 'gone' }
      })
      expect(await t.chats.send(KEY, '3', 'c')).toEqual({
        outcome: 'refused',
        reason: 'chat_lost'
      })
    })

    it('tells the end of a turn with that turn’s own reply and start', async () => {
      const t = await started()
      t.fake.setJournal({
        items: [
          item('turn-a', {
            kind: 'turn',
            turnId: 'T1',
            state: 'completed',
            startedAt: 5_000
          }),
          said('m1', 'Testes verdes.', 'turn-a'),
          item('turn-b', {
            kind: 'turn',
            turnId: 'T2',
            state: 'running',
            startedAt: 6_000
          }),
          said('m2', 'rodando o próximo', 'turn-b')
        ]
      })
      t.fake.completion({
        type: 'completion',
        completion: {
          scope: {
            executionHostId: 'local',
            wslDistro: null,
            workspaceId: 'wt-new'
          },
          sessionId: t.sessionId,
          turnId: 'T1',
          outcome: 'success',
          completedAt: 7_000
        }
      } as AgentSessionTurnCompletionEvent)
      await settle()
      expect(t.events).toContainEqual({
        kind: 'turn-ended',
        conversation: KEY,
        turnId: 5_000,
        lastAssistantMessage: 'Testes verdes.'
      })
    })

    it('tells a question the agent raised, and answers it with the chosen option', async () => {
      const t = await started()
      t.fake.setJournal({ items: [asked('q-item')] })
      t.fake.completion({
        type: 'prompt',
        prompt: { sessionId: t.sessionId, promptId: 'q-item', raisedAt: 1 }
      } as AgentSessionTurnCompletionEvent)
      await settle()
      expect(t.events).toContainEqual({
        kind: 'prompt',
        conversation: KEY,
        prompt: {
          kind: 'question',
          promptId: 'q-item',
          question: 'Qual ambiente?',
          options: [
            { id: 'stg', label: 'Homologação' },
            { id: 'prd', label: 'Produção' }
          ]
        }
      })
      expect((await t.chats.pendingPrompt(KEY))?.promptId).toBe('q-item')

      expect(await t.chats.answer(KEY, 'q-item', 'nope')).toEqual({
        outcome: 'refused',
        reason: 'option_not_offered'
      })
      expect(await t.chats.answer(KEY, 'q-item', 'prd')).toEqual({
        outcome: 'accepted'
      })
      const [caller, request] = t.fake.raw.respondToPrompt.mock.calls[0] as unknown as [
        unknown,
        Record<string, unknown> & { envelope: { payloadFingerprint: string } }
      ]
      expect(caller).toEqual({ callerKey: 'trusted-local:orca-pit-whatsapp' })
      const answers = [{ questionId: 'q1', optionIds: ['prd'] }]
      expect(request).toMatchObject({
        kind: 'question',
        itemId: 'q-item',
        expectedRevision: 3,
        answers,
        envelope: { sessionId: t.sessionId, expectedRuntimeFence: 4 }
      })
      expect(request.envelope.payloadFingerprint).toBe(
        computeAgentSessionPayloadFingerprint({
          method: 'agentSession.respondTo:question',
          sessionId: t.sessionId,
          fields: {
            itemId: 'q-item',
            expectedRevision: 3,
            optionId: undefined,
            answers
          }
        })
      )
    })

    it('tells a turn beginning when the chat starts working', async () => {
      const t = await started()
      t.events.length = 0
      const working = { sessionId: t.sessionId, status: 'working' } as never
      t.fake.status({ type: 'status', session: working })
      t.fake.status({ type: 'status', session: working })
      expect(t.events).toEqual([{ kind: 'turn-started', conversation: KEY }])
    })
  })
})
