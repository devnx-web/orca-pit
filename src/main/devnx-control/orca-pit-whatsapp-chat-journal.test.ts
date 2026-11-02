import { describe, expect, it } from 'vitest'
import type {
  AgentJournalItemBody,
  AgentJournalRenderItem
} from '../../shared/agent-session-journal-types'
import {
  chatPrompt,
  pendingPromptItem,
  promptAnswer,
  sendHeld,
  turnReply,
  type WhatsappPromptItem
} from './orca-pit-whatsapp-chat-journal'

const PENDING = {
  state: 'pending',
  selectedOptionId: null,
  resolvedBy: null,
  resolvedAt: null
} as const

function item(
  itemId: string,
  body: AgentJournalItemBody,
  turnItemId?: string
): AgentJournalRenderItem {
  return {
    itemId,
    revision: 2,
    sequence: 1,
    observedAt: 1,
    body,
    ...(turnItemId ? { turnScope: { kind: 'turn' as const, turnItemId } } : {})
  }
}

const approval = item('a1', {
  kind: 'approval',
  title: 'Bash',
  detail: 'rm -rf dist',
  options: [
    { id: 'allow_once', label: 'Allow' },
    { id: 'reject_once', label: 'Reject' }
  ],
  resolution: PENDING
}) as WhatsappPromptItem

describe('the chat journal, as the WhatsApp bridge reads it', () => {
  it('reads an approval with its options and answers it by option id', () => {
    expect(pendingPromptItem([approval])).toBe(approval)
    expect(chatPrompt(approval)).toEqual({
      kind: 'approval',
      promptId: 'a1',
      tool: 'Bash',
      summary: 'rm -rf dist',
      options: [
        { id: 'allow_once', label: 'Allow' },
        { id: 'reject_once', label: 'Reject' }
      ]
    })
    expect(promptAnswer(approval, 'reject_once')).toEqual({
      itemId: 'a1',
      expectedRevision: 2,
      kind: 'approval',
      optionId: 'reject_once'
    })
    expect(promptAnswer(approval, 'other')).toBeNull()
  })

  it('leaves a prompt a number cannot answer to Orca', () => {
    const several = item('q2', {
      kind: 'question',
      question: '',
      options: [],
      questions: [
        { id: 'a', question: 'Um?', multiSelect: false, options: [{ id: 'x', label: 'X' }] },
        { id: 'b', question: 'Dois?', multiSelect: false, options: [{ id: 'y', label: 'Y' }] }
      ],
      resolution: PENDING
    }) as WhatsappPromptItem
    expect(chatPrompt(several)).toEqual({ kind: 'unsupported', promptId: 'q2' })
    expect(promptAnswer(several, 'x')).toBeNull()
  })

  it('skips prompts already answered', () => {
    const answered = item('a0', {
      ...(approval.body as Extract<AgentJournalItemBody, { kind: 'approval' }>),
      resolution: { ...PENDING, state: 'resolved', selectedOptionId: 'allow_once' }
    })
    expect(pendingPromptItem([answered])).toBeNull()
  })

  it('reads the reply of the named turn, not the newest one', () => {
    const items = [
      item('t1', { kind: 'turn', turnId: 'T1', state: 'completed', requestedAt: 10 }),
      item(
        'm1',
        { kind: 'message', role: 'assistant', blocks: [{ type: 'text', text: ' Feito. ' }] },
        't1'
      ),
      item(
        'u2',
        { kind: 'message', role: 'user', blocks: [{ type: 'text', text: 'e agora?' }] },
        't2'
      ),
      item('t2', { kind: 'turn', turnId: 'T2', state: 'running', startedAt: 20 })
    ]
    expect(turnReply(items, 'T1')).toEqual({ startedAt: 10, reply: 'Feito.' })
    expect(turnReply(items, 'T2')).toEqual({ startedAt: 20, reply: '' })
    expect(turnReply(items, 'unknown').startedAt).toBeNull()
  })

  it('tells a send still held for the agent', () => {
    const submission = (dispatchState: 'pending' | 'accepted') => ({
      clientMessageId: 'open',
      fence: 1,
      payloadFingerprint: 'f',
      dispatchState,
      providerItemId: null,
      reason: null,
      submittedAt: 1,
      resolvedAt: null
    })
    expect(sendHeld([submission('pending')], 'open')).toBe(true)
    expect(sendHeld([submission('accepted')], 'open')).toBe(false)
    expect(sendHeld([], 'open')).toBe(false)
  })
})
