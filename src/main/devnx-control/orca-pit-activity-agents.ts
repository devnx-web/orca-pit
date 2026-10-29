// Orca-Pit: agent_started / agent_stopped from Orca's agent status rows. A row appearing for a
// pane is an agent starting there (terminal CLIs through their hooks, native chats through
// the structured status feed); the row leaving is the agent stopping.
import { structuredAgentSessionTabId } from '../../shared/structured-agent-session-projection'
import type { AgentStatusIpcPayload } from '../../shared/agent-status-ipc-payload'
import type { AgentHookStatusRowMutation } from '../agent-hooks/server/server-types'
import { workspaceContext, type OrcaPitActor } from './orca-pit-activity-context'
import type { OrcaPitTokenTotals } from './orca-pit-activity-tokens'
import type { OrcaPitActivityDraft } from './orca-pit-activity-types'

export type OrcaPitAgentStatusSource = {
  getStatusSnapshot(): AgentStatusIpcPayload[]
  getStatusSnapshotForPane(paneKey: string): AgentStatusIpcPayload[]
  subscribeStatusRowMutations(listener: (mutation: AgentHookStatusRowMutation) => void): () => void
}

export type OrcaPitAgentTrackerDeps = {
  record(draft: OrcaPitActivityDraft): void
  /** Who drove this pane last, falling back to the central machine's owner. */
  actorForPane(paneKey: string): OrcaPitActor
  /** Tokens of a stopped session, already net of what earlier stops reported. */
  tokensForStop(agent: string, providerSessionId: string | null): Promise<OrcaPitTokenTotals | null>
  now?: () => number
}

type OpenAgent = {
  agent: string
  /** Fixed at start so start and stop pair up in the Control's agent_hours. */
  sessionId: string
  providerSessionId: string | null
  worktreeId: string | null
  actor: OrcaPitActor
}

const STRUCTURED_TAB_PREFIX = structuredAgentSessionTabId('')

function structuredSessionIdOf(paneKey: string): string | null {
  const tabId = paneKey.slice(0, Math.max(0, paneKey.indexOf(':')))
  return tabId.startsWith(STRUCTURED_TAB_PREFIX) ? tabId.slice(STRUCTURED_TAB_PREFIX.length) : null
}

export class OrcaPitAgentTracker {
  private readonly open = new Map<string, OpenAgent>()
  private readonly dirty = new Set<string>()
  private source: OrcaPitAgentStatusSource | null = null
  private scheduled = false
  private unsubscribe: (() => void) | null = null

  constructor(private readonly deps: OrcaPitAgentTrackerDeps) {}

  attach(source: OrcaPitAgentStatusSource): void {
    this.detach()
    this.source = source
    // Agents already running were started before this process: track them, report only their stop.
    for (const row of source.getStatusSnapshot()) {
      if (row.agentType && !this.open.has(row.paneKey)) {
        this.open.set(row.paneKey, this.openFor(row, this.deps.actorForPane(row.paneKey)))
      }
    }
    this.unsubscribe = source.subscribeStatusRowMutations(({ before, after }) => {
      if (before) {
        this.dirty.add(before.paneKey)
      }
      if (after) {
        this.dirty.add(after.paneKey)
      }
      this.schedule()
    })
  }

  detach(): void {
    this.unsubscribe?.()
    this.unsubscribe = null
    this.source = null
  }

  /** The agent running in a pane, for lines typed into it. */
  agentForPane(paneKey: string): { agent: string; sessionId: string } | null {
    const open = this.open.get(paneKey)
    return open ? { agent: open.agent, sessionId: open.sessionId } : null
  }

  // Why batched: hook rows change on every tool call; one pass per tick reads each pane once.
  private schedule(): void {
    if (this.scheduled) {
      return
    }
    this.scheduled = true
    setImmediate(() => {
      this.scheduled = false
      this.flush()
    })
  }

  flush(): void {
    const paneKeys = [...this.dirty]
    this.dirty.clear()
    for (const paneKey of paneKeys) {
      const row = this.source?.getStatusSnapshotForPane(paneKey).find((item) => item.agentType)
      const current = this.open.get(paneKey)
      if (!row) {
        if (current) {
          this.stop(paneKey, current)
        }
        continue
      }
      const providerSessionId = row.providerSession?.id ?? null
      if (current) {
        const sameAgent = current.agent === row.agentType
        const sameSession =
          !current.providerSessionId ||
          !providerSessionId ||
          current.providerSessionId === providerSessionId
        if (sameAgent && sameSession) {
          current.providerSessionId ??= providerSessionId
          continue
        }
        this.stop(paneKey, current)
      }
      this.start(paneKey, row)
    }
  }

  private openFor(row: AgentStatusIpcPayload, actor: OrcaPitActor): OpenAgent {
    const providerSessionId = row.providerSession?.id ?? null
    return {
      agent: row.agentType ?? 'agent',
      sessionId: (structuredSessionIdOf(row.paneKey) ?? providerSessionId ?? row.paneKey).slice(
        0,
        190
      ),
      providerSessionId,
      worktreeId: row.worktreeId ?? null,
      actor
    }
  }

  private draft(open: OpenAgent, action: 'agent_started' | 'agent_stopped'): OrcaPitActivityDraft {
    return {
      ...workspaceContext(open.worktreeId),
      action,
      user_id: open.actor.userId,
      device_label: open.actor.deviceLabel,
      localActor: open.actor.localActor,
      session_id: open.sessionId,
      agent: open.agent,
      tokens_in: null,
      tokens_out: null,
      detail: null,
      atMs: (this.deps.now ?? Date.now)()
    }
  }

  private start(paneKey: string, row: AgentStatusIpcPayload): void {
    const open = this.openFor(row, this.deps.actorForPane(paneKey))
    this.open.set(paneKey, open)
    this.deps.record(this.draft(open, 'agent_started'))
  }

  private stop(paneKey: string, open: OpenAgent): void {
    this.open.delete(paneKey)
    const draft = this.draft(open, 'agent_stopped')
    void this.deps
      .tokensForStop(open.agent, open.providerSessionId)
      .catch(() => null)
      .then((tokens) => {
        this.deps.record(
          tokens ? { ...draft, tokens_in: tokens.tokensIn, tokens_out: tokens.tokensOut } : draft
        )
      })
  }
}
