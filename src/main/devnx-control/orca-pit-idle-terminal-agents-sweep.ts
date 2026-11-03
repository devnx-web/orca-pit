// Orca-Pit: the idle-agent sweep itself, with every outside read and act passed in (see
// orca-pit-idle-terminal-agents.ts for the wiring and orca-pit-idle-terminal-agents-rules.ts for
// who may be stopped).
import type { AgentStatusIpcPayload } from '../../shared/agent-status-ipc-payload'
import type { ProcessTableRow } from '../../shared/process-table-snapshot'
import type { PtyProcessInfo } from '../providers/pty-process-info'
import {
  ORCA_PIT_IDLE_TERMINAL_AGENT_MS,
  ORCA_PIT_IDLE_TERMINAL_SWEEP_MS,
  TerminalOutputQuietClock,
  idleAgentNotice,
  idleAgentResumeCommand,
  judgeIdleTerminalAgent,
  pickAgentProcessToStop,
  shellHoldsTerminal,
  type AgentProcessToStop
} from './orca-pit-idle-terminal-agents-rules'

// Claude flushes its session and runs its SessionEnd hook on SIGTERM; give it time to do so.
const EXIT_WAIT_MS = 15_000
const EXIT_POLL_MS = 500
// The shell reprints its prompt after the agent leaves; the notice goes after that.
const PROMPT_SETTLE_MS = 400

export type IdleTerminalPane = {
  ptyId: string
  handle: string | null
  rootPid: number
  /** The output counter the verdict was made on. */
  sequence: number
  decidedAt: number
}

export type IdleTerminalAgentsDeps = {
  statusRows: () => AgentStatusIpcPayload[]
  /** This machine's live PTYs; SSH panes are not in it. */
  localPtys: () => Promise<PtyProcessInfo[]>
  outputSequence: (ptyId: string) => number
  lastInputAt: (ptyId: string) => number | null
  /** The composer text the agent holds unsent ('' for none); null when the screen cannot be read. */
  readDraft: (handle: string) => Promise<string | null>
  processRows: (rootPid: number) => Promise<ProcessTableRow[] | null>
  signal: (pid: number) => void
  writeNotice: (rootPid: number, text: string) => Promise<void>
  /** Types into the shell's prompt; `enter` gives a fresh prompt below the notice. */
  typeAtPrompt: (handle: string, input: { text?: string; enter?: boolean }) => Promise<void>
  now: () => number
  wait: (ms: number) => Promise<void>
  log: (text: string, cause?: unknown) => void
  idleMs?: number
}

function findPane(
  row: AgentStatusIpcPayload,
  ptys: readonly PtyProcessInfo[]
): PtyProcessInfo | null {
  return (
    ptys.find((pty) => pty.paneKey === row.paneKey) ??
    (row.terminalHandle ? ptys.find((pty) => pty.terminalHandle === row.terminalHandle) : null) ??
    null
  )
}

export class IdleTerminalAgentsSweep {
  private readonly quiet = new TerminalOutputQuietClock()
  /** paneKey + turn already signalled, so a stop that did not take is not retried every tick. */
  private readonly attempted = new Set<string>()
  /** paneKey + turn already reported as kept for its draft, so the log says it once. */
  private readonly draftNoted = new Set<string>()
  private running = false
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly deps: IdleTerminalAgentsDeps) {}

  start(): void {
    if (this.timer) {
      return
    }
    this.timer = setInterval(() => void this.tick(), ORCA_PIT_IDLE_TERMINAL_SWEEP_MS)
    // Why no tick now: the first one, in 5 min, only starts each pane's quiet clock anyway.
    this.timer.unref?.()
  }

  dispose(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  async tick(): Promise<void> {
    if (this.running) {
      return
    }
    this.running = true
    try {
      await this.sweep()
    } catch (error) {
      this.deps.log('idle sweep failed', error)
    } finally {
      this.running = false
    }
  }

  private lastActivityAt(ptyId: string, now: number): number {
    const quietSince = this.quiet.observe(ptyId, this.deps.outputSequence(ptyId), now)
    return Math.max(quietSince, this.deps.lastInputAt(ptyId) ?? 0)
  }

  private async sweep(): Promise<void> {
    const ptys = await this.deps.localPtys()
    const live = new Set(ptys.map((pty) => pty.id))
    this.quiet.retain(live)
    const now = this.deps.now()
    // Read every live PTY's counter each tick, so output between ticks restarts its clock.
    const activity = new Map<string, number>()
    for (const ptyId of live) {
      activity.set(ptyId, this.lastActivityAt(ptyId, now))
    }
    for (const row of this.deps.statusRows()) {
      const pty = findPane(row, ptys)
      const lastActivityAt = pty ? activity.get(pty.id) : undefined
      if (!pty?.rootProcessId || lastActivityAt === undefined || pty.exiting) {
        continue
      }
      const verdict = judgeIdleTerminalAgent(row, lastActivityAt, now, this.deps.idleMs)
      const turnKey = `${row.paneKey}\u0000${row.stateStartedAt}`
      if (verdict.kind !== 'stop' || this.attempted.has(turnKey)) {
        continue
      }
      await this.stopIdleAgent(row, turnKey, {
        ptyId: pty.id,
        handle: pty.terminalHandle ?? row.terminalHandle ?? null,
        rootPid: pty.rootProcessId,
        sequence: this.deps.outputSequence(pty.id),
        decidedAt: now
      })
    }
  }

  private async stopIdleAgent(
    row: AgentStatusIpcPayload,
    turnKey: string,
    pane: IdleTerminalPane
  ): Promise<void> {
    const agentType = row.agentType ?? ''
    // An unsent draft would die with the agent: wait for the person instead (checked every tick).
    if (!pane.handle) {
      return
    }
    const draft = await this.deps.readDraft(pane.handle).catch(() => null)
    if (draft === null) {
      return
    }
    if (draft.trim()) {
      if (!this.draftNoted.has(turnKey)) {
        if (this.draftNoted.size >= 1024) {
          this.draftNoted.clear()
        }
        this.draftNoted.add(turnKey)
        this.deps.log(`kept ${agentType} in ${row.paneKey}: unsent text in its prompt`)
      }
      return
    }
    const rows = await this.deps.processRows(pane.rootPid)
    const target = rows ? pickAgentProcessToStop(rows, pane.rootPid, agentType) : null
    if (!target || !this.stillIdle(row, pane)) {
      return
    }
    if (this.attempted.size >= 1024) {
      this.attempted.clear()
    }
    this.attempted.add(turnKey)
    try {
      this.deps.signal(target.pid)
    } catch (error) {
      this.deps.log(`could not signal ${agentType} (pid ${target.pid})`, error)
      return
    }
    if (!(await this.waitForExit(pane.rootPid, target))) {
      this.deps.log(`${agentType} (pid ${target.pid}) did not exit after SIGTERM; left running`)
      return
    }
    const idleMinutes = Math.round((this.deps.idleMs ?? ORCA_PIT_IDLE_TERMINAL_AGENT_MS) / 60_000)
    this.deps.log(
      `stopped ${agentType} (pid ${target.pid}) in ${row.paneKey}: ${idleMinutes} min idle`
    )
    await this.leaveNotice(row, pane, target)
  }

  /** Reads above took a moment: a key, a line of output or a new turn since then calls it off. */
  private stillIdle(row: AgentStatusIpcPayload, pane: IdleTerminalPane): boolean {
    const current = this.deps
      .statusRows()
      .find((candidate) => candidate.paneKey === row.paneKey && candidate.agentType)
    return (
      this.deps.outputSequence(pane.ptyId) === pane.sequence &&
      (this.deps.lastInputAt(pane.ptyId) ?? 0) <= pane.decidedAt &&
      current?.state === 'done' &&
      current.stateStartedAt === row.stateStartedAt
    )
  }

  private async waitForExit(rootPid: number, target: AgentProcessToStop): Promise<boolean> {
    const deadline = this.deps.now() + EXIT_WAIT_MS
    while (this.deps.now() < deadline) {
      await this.deps.wait(EXIT_POLL_MS)
      const rows = await this.deps.processRows(rootPid)
      // null is "ps could not say": keep asking until the deadline.
      if (rows && !rows.some((row) => row.pid === target.pid && row.command === target.command)) {
        return true
      }
    }
    return false
  }

  private async leaveNotice(
    row: AgentStatusIpcPayload,
    pane: IdleTerminalPane,
    target: AgentProcessToStop
  ): Promise<void> {
    const agentType = row.agentType ?? ''
    await this.deps.wait(PROMPT_SETTLE_MS)
    const rows = await this.deps.processRows(pane.rootPid)
    const atPrompt = !!rows && shellHoldsTerminal(rows, pane.rootPid)
    const resume = idleAgentResumeCommand(agentType, row.providerSession, target.command)
    // Only into a bare shell prompt: the agent took any typeahead with it, so nothing is overwritten.
    const types = atPrompt && !!pane.handle
    try {
      await this.deps.writeNotice(
        pane.rootPid,
        idleAgentNotice(agentType, resume, types && !!resume)
      )
    } catch (error) {
      this.deps.log('could not write the notice to the terminal', error)
    }
    if (!types || !pane.handle) {
      return
    }
    try {
      await this.deps.typeAtPrompt(pane.handle, { enter: true })
      if (resume) {
        await this.deps.typeAtPrompt(pane.handle, { text: resume })
      }
    } catch (error) {
      this.deps.log('could not type the resume command', error)
    }
  }
}
