// Orca-Pit: the one place events enter the diary. Callers hand it what a person did; it signs
// the event, remembers who drove each pane last (the sidebar's "who") and writes in batches
// off the request path.
import { asksForSecretNext, maskTerminalLine, redactAgentText } from './orca-pit-activity-secrets'
import {
  actorForCaller,
  firstName,
  workspaceContext,
  type OrcaPitActor
} from './orca-pit-activity-context'
import type { OrcaPitActivityDb } from './orca-pit-activity-db'
import {
  clipDetail,
  type OrcaPitActivityDraft,
  type OrcaPitPresenceAction
} from './orca-pit-activity-types'
import { OrcaPitLineBuffer } from './orca-pit-terminal-lines'
import type { OrcaPitAgentAuthors, OrcaPitPaneAuthor } from '../../shared/orca-pit-agent-authors'

export type OrcaPitTerminalTarget = {
  paneKey: string | null
  worktreeId: string | null
}

const MAX_QUEUED = 5000
const MAX_AUTHORS = 1000
// Why 60s: a password prompt follows its command at once; later lines are ordinary commands.
const SECRET_PROMPT_WINDOW_MS = 60_000
// Why: an agent that starts long after the last command was not started by that command.
const AUTHOR_FOR_START_MS = 15 * 60_000

type AuthorRecord = OrcaPitPaneAuthor & { actor: OrcaPitActor }

type AgentLookup = (paneKey: string) => { agent: string; sessionId: string } | null

export class OrcaPitActivityRecorder {
  private db: OrcaPitActivityDb | null = null
  private queue: OrcaPitActivityDraft[] = []
  private flushScheduled = false
  private readonly authors = new Map<string, AuthorRecord>()
  private readonly lines = new OrcaPitLineBuffer()
  private readonly secretPromptUntil = new Map<string, number>()
  private agentLookup: AgentLookup = () => null

  constructor(private readonly now: () => number = Date.now) {}

  attach(db: OrcaPitActivityDb, agentLookup: AgentLookup): void {
    this.db = db
    this.agentLookup = agentLookup
    this.scheduleFlush()
  }

  detach(): void {
    this.flush()
    this.db = null
  }

  record(draft: OrcaPitActivityDraft): void {
    if (this.queue.length >= MAX_QUEUED) {
      this.queue.shift()
    }
    this.queue.push(draft)
    this.scheduleFlush()
  }

  /** A person drove this pane; programmatic callers (agents through the CLI) do not count. */
  noteAuthor(paneKey: string | null, actor: OrcaPitActor): void {
    const name = firstName(actor.name)
    if (!paneKey || !name || actor.programmatic) {
      return
    }
    this.authors.delete(paneKey)
    this.authors.set(paneKey, { name, at: this.now(), actor })
    if (this.authors.size > MAX_AUTHORS) {
      const oldest = this.authors.keys().next().value
      if (oldest !== undefined) {
        this.authors.delete(oldest)
      }
    }
  }

  authorsByPane(): OrcaPitAgentAuthors {
    const out: OrcaPitAgentAuthors = {}
    for (const [paneKey, { name, at, actor }] of this.authors) {
      out[paneKey] = { name, at, userId: actor.userId }
    }
    return out
  }

  actorForPane(paneKey: string): OrcaPitActor {
    const author = this.authors.get(paneKey)
    return author && this.now() - author.at < AUTHOR_FOR_START_MS
      ? author.actor
      : actorForCaller({ kind: 'desktop' })
  }

  /**
   * Keystrokes for one terminal. Only a finished line (Enter) becomes an event; the target is
   * resolved only then, so typing costs a string append.
   */
  observeTerminalInput(
    terminalKey: string,
    data: string,
    actor: OrcaPitActor | (() => OrcaPitActor),
    resolveTarget: () => OrcaPitTerminalTarget
  ): void {
    const lines = this.lines.feed(terminalKey, data)
    if (lines.length === 0) {
      return
    }
    const signer = typeof actor === 'function' ? actor() : actor
    const target = resolveTarget()
    const running = target.paneKey ? this.agentLookup(target.paneKey) : null
    const context = workspaceContext(target.worktreeId)
    for (const line of lines) {
      const armedUntil = this.secretPromptUntil.get(terminalKey) ?? 0
      const afterPrompt = !running && armedUntil > this.now()
      this.secretPromptUntil.delete(terminalKey)
      if (!running && asksForSecretNext(line)) {
        this.secretPromptUntil.set(terminalKey, this.now() + SECRET_PROMPT_WINDOW_MS)
      }
      this.record({
        ...context,
        // A line typed into an agent's own input box is a message to that agent.
        action: running ? 'agent_message' : 'terminal_line',
        user_id: signer.userId,
        device_label: signer.deviceLabel,
        localActor: signer.localActor,
        session_id: running?.sessionId ?? null,
        agent: running?.agent ?? null,
        tokens_in: null,
        tokens_out: null,
        detail: clipDetail(maskTerminalLine(line, afterPrompt)),
        atMs: this.now()
      })
    }
    this.noteAuthor(target.paneKey, signer)
  }

  forgetTerminal(terminalKey: string): void {
    this.lines.forget(terminalKey)
    this.secretPromptUntil.delete(terminalKey)
  }

  recordAgentMessage(args: {
    actor: OrcaPitActor
    text: string
    paneKey: string | null
    worktreeId: string | null
    sessionId: string
    agent: string | null
  }): void {
    this.record({
      ...workspaceContext(args.worktreeId),
      action: 'agent_message',
      user_id: args.actor.userId,
      device_label: args.actor.deviceLabel,
      localActor: args.actor.localActor,
      session_id: args.sessionId,
      agent: args.agent,
      tokens_in: null,
      tokens_out: null,
      detail: clipDetail(redactAgentText(args.text)),
      atMs: this.now()
    })
    this.noteAuthor(args.paneKey, args.actor)
  }

  recordSimple(
    action: 'workspace_created' | 'settings_changed' | 'login',
    actor: OrcaPitActor,
    worktreeId: string | null,
    detail: string | null
  ): void {
    this.record({
      ...workspaceContext(worktreeId),
      action,
      user_id: actor.userId,
      device_label: actor.deviceLabel,
      localActor: actor.localActor,
      session_id: null,
      agent: null,
      tokens_in: null,
      tokens_out: null,
      detail: clipDetail(detail),
      atMs: this.now()
    })
  }

  /** Presence keeps its own moment: an idle event is stamped when the person stopped, not now. */
  recordPresence(action: OrcaPitPresenceAction, actor: OrcaPitActor, atMs: number): void {
    this.record({
      ...workspaceContext(null),
      action,
      user_id: actor.userId,
      device_label: actor.deviceLabel,
      localActor: actor.localActor,
      session_id: null,
      agent: null,
      tokens_in: null,
      tokens_out: null,
      detail: null,
      atMs
    })
    // Leaving or quitting may end the process before the next tick writes the queue.
    if (action === 'presence_end') {
      this.flush()
    }
  }

  private scheduleFlush(): void {
    if (this.flushScheduled || !this.db) {
      return
    }
    this.flushScheduled = true
    setImmediate(() => {
      this.flushScheduled = false
      this.flush()
    })
  }

  flush(): void {
    const db = this.db
    if (!db || this.queue.length === 0) {
      return
    }
    const batch = this.queue
    this.queue = []
    try {
      db.insert(batch)
    } catch (error) {
      console.warn('[orca-pit] activity diary write failed:', error)
    }
  }
}

export const orcaPitActivity = new OrcaPitActivityRecorder()
