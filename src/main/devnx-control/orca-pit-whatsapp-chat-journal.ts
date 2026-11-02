// Orca-Pit: what the WhatsApp bridge reads in a native chat's journal: the question waiting on the
// user (as numbered options) and the answer to send for a number, and the reply of a finished turn.
import type { PendingPrompt } from '../../shared/agent-pending-prompt'
import { isRootAgentJournalItem } from '../../shared/agent-session-journal-producer'
import type {
  AgentJournalApprovalItem,
  AgentJournalQuestionItem,
  AgentJournalRenderItem,
  AgentJournalSubmission
} from '../../shared/agent-session-journal-types'
import {
  agentSessionPromptQuestions,
  type AgentSessionQuestionAnswer
} from '../../shared/agent-session-question-answer'
import { withoutNativeChatVisualDirectiveLines } from '../../shared/native-chat/native-chat-visual-directive'
import { latestStructuredAgentSessionAssistantMessage } from '../../shared/structured-agent-session-latest-request'

export type WhatsappPromptItem = AgentJournalRenderItem & {
  body: AgentJournalApprovalItem | AgentJournalQuestionItem
}

/** The chat host's prompt answer, as `respondToPrompt` takes it. */
export type WhatsappPromptAnswer = {
  itemId: string
  expectedRevision: number
  kind: 'approval' | 'question'
  optionId?: string
  answers?: AgentSessionQuestionAnswer[]
}

function isPromptItem(item: AgentJournalRenderItem): item is WhatsappPromptItem {
  return item.body.kind === 'approval' || item.body.kind === 'question'
}

/** The newest prompt still waiting on the user; null when none waits. */
export function pendingPromptItem(
  items: readonly AgentJournalRenderItem[],
  promptId?: string
): WhatsappPromptItem | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (
      item &&
      isPromptItem(item) &&
      item.body.resolution.state === 'pending' &&
      (promptId === undefined || item.itemId === promptId)
    ) {
      return item
    }
  }
  return null
}

/** The one question a number can answer; null for several questions or a multiple choice. */
function singleQuestion(body: AgentJournalQuestionItem) {
  const questions = agentSessionPromptQuestions(body)
  const question = questions.length === 1 ? questions[0] : undefined
  return question && !question.multiSelect && question.options.length > 0 ? question : null
}

export function chatPrompt(item: WhatsappPromptItem): PendingPrompt {
  const { body } = item
  if (body.kind === 'approval') {
    const summary = body.description ?? body.detail ?? undefined
    return {
      kind: 'approval',
      promptId: item.itemId,
      tool: body.displayName ?? body.title,
      ...(summary ? { summary } : {}),
      options: body.options.map(({ id, label }) => ({ id, label }))
    }
  }
  const question = singleQuestion(body)
  if (!question) {
    return { kind: 'unsupported', promptId: item.itemId }
  }
  return {
    kind: 'question',
    promptId: item.itemId,
    question: question.question,
    ...(question.header ? { header: question.header } : {}),
    options: question.options.map(({ id, label }) => ({ id, label }))
  }
}

/** The answer that picks `optionId`; null when the prompt does not offer it. */
export function promptAnswer(
  item: WhatsappPromptItem,
  optionId: string
): WhatsappPromptAnswer | null {
  const target = { itemId: item.itemId, expectedRevision: item.revision }
  const { body } = item
  if (body.kind === 'approval') {
    return body.options.some((option) => option.id === optionId)
      ? { ...target, kind: 'approval', optionId }
      : null
  }
  const question = singleQuestion(body)
  return question?.options.some((option) => option.id === optionId)
    ? {
        ...target,
        kind: 'question',
        answers: [{ questionId: question.id, optionIds: [optionId] }]
      }
    : null
}

function prose(item: AgentJournalRenderItem): string {
  const { body } = item
  if (body.kind !== 'message' || body.role !== 'assistant' || !isRootAgentJournalItem(item)) {
    return ''
  }
  const text = body.blocks.flatMap((block) => (block.type === 'text' ? [block.text] : []))
  return withoutNativeChatVisualDirectiveLines(text.join('\n')).trim()
}

/** The finished turn's start and its last words. Why per turn: a queued message may already have
 *  opened the next turn by the time this is read, and its answer is not this one's. */
export function turnReply(
  items: readonly AgentJournalRenderItem[],
  turnId: string
): { startedAt: number | null; reply: string } {
  const turn = items.find((item) => item.body.kind === 'turn' && item.body.turnId === turnId)
  if (!turn || turn.body.kind !== 'turn') {
    return {
      startedAt: null,
      reply: latestStructuredAgentSessionAssistantMessage(items).trim()
    }
  }
  const startedAt = turn.body.startedAt ?? turn.body.requestedAt ?? null
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    const scope = item?.turnScope
    const text =
      item && scope?.kind === 'turn' && scope.turnItemId === turn.itemId ? prose(item) : ''
    if (text) {
      return { startedAt, reply: text }
    }
  }
  return { startedAt, reply: '' }
}

/** Whether the agent took any message of the chat yet. */
export function chatStarted(submissions: readonly AgentJournalSubmission[]): boolean {
  return submissions.some((submission) => submission.dispatchState === 'accepted')
}

/** The send is still held for the agent: neither taken nor turned away. */
export function sendHeld(
  submissions: readonly AgentJournalSubmission[],
  clientMessageId: string
): boolean {
  const submission = submissions.find((entry) => entry.clientMessageId === clientMessageId)
  return submission?.dispatchState === 'pending'
}
