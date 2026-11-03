// Orca-Pit: who the idle-agent sweep may stop. Pure rules, so the decision is tested without a
// terminal: an agent CLI running in an Orca terminal (Claude, Codex, ...) whose turn ended and
// whose terminal saw no key and no output for two hours. Native chats have their own 30 min rule
// (structured-agent-session-idle-sweep) and never pass here.
import { recognizeAgentProcessFromCommandLine } from '../../shared/agent-process-recognition'
import { getAgentResumeArgv } from '../../shared/agent-resume-argv'
import { buildAgentResumeLaunchCommand } from '../../shared/agent-resume-launch-command'
import {
  isResumableTuiAgent,
  type AgentProviderSessionMetadata
} from '../../shared/agent-session-resume'
import type { AgentStatusIpcPayload } from '../../shared/agent-status-ipc-payload'
import type { ProcessTableRow } from '../../shared/process-table-snapshot'
import { isShellProcess } from '../../shared/shell-process-detection'
import { structuredAgentSessionTabId } from '../../shared/structured-agent-session-projection'

// Why 2 hours (pedido do dono, nov/2026): an agent left in a terminal stays alive for days
// (one Claude ran 5 days on the Nitro5; three held ~1 GB for 18 h here). Two hours without a
// key or a line of output is "forgotten", not "thinking"; the conversation is saved and resumes.
// Business rule, so a literal here — not a setting and not an environment variable.
export const ORCA_PIT_IDLE_TERMINAL_AGENT_MS = 2 * 60 * 60_000

// Why 5 min: reading the status rows and one output counter per pane is cheap, and a stop that
// comes a few minutes after the two hours costs nothing.
export const ORCA_PIT_IDLE_TERMINAL_SWEEP_MS = 5 * 60_000

export type IdleAgentRow = Pick<
  AgentStatusIpcPayload,
  | 'paneKey'
  | 'state'
  | 'stateStartedAt'
  | 'agentType'
  | 'subagents'
  | 'mainAgent'
  | 'claudeTaskWakeupPending'
  | 'interactivePrompt'
  | 'providerSessionOnly'
  | 'structuredHost'
  | 'workingMode'
>

export type IdleAgentVerdict =
  | { kind: 'stop' }
  | {
      kind: 'keep'
      reason:
        | 'native-chat'
        | 'no-agent'
        | 'not-done'
        | 'asking'
        | 'background-work'
        | 'recent-activity'
    }

const STRUCTURED_TAB_PREFIX = structuredAgentSessionTabId('')

function isNativeChatPane(row: IdleAgentRow): boolean {
  return !!row.structuredHost || row.paneKey.startsWith(STRUCTURED_TAB_PREFIX)
}

/**
 * Whether this pane's agent has been idle long enough to stop. `lastActivityAt` is the latest of
 * the terminal's last key and last output as the sweep saw them; the row's own clock counts too,
 * so a turn that ended a minute ago is never "two hours idle".
 */
export function judgeIdleTerminalAgent(
  row: IdleAgentRow,
  lastActivityAt: number,
  now: number,
  idleMs: number = ORCA_PIT_IDLE_TERMINAL_AGENT_MS
): IdleAgentVerdict {
  if (isNativeChatPane(row)) {
    return { kind: 'keep', reason: 'native-chat' }
  }
  if (row.providerSessionOnly || !row.agentType) {
    return { kind: 'keep', reason: 'no-agent' }
  }
  // working, blocked (permission) and waiting (a question) all leave the agent alone.
  if (row.state !== 'done' || (row.mainAgent && row.mainAgent.state !== 'done')) {
    return { kind: 'keep', reason: 'not-done' }
  }
  if (row.interactivePrompt) {
    return { kind: 'keep', reason: 'asking' }
  }
  // A launched Claude task still owes its wake-up; a child not known idle may still be working.
  if (
    row.claudeTaskWakeupPending !== undefined ||
    row.workingMode !== undefined ||
    row.subagents?.some((child) => child.state !== 'idle')
  ) {
    return { kind: 'keep', reason: 'background-work' }
  }
  const since = Math.max(lastActivityAt, row.stateStartedAt, row.mainAgent?.stateStartedAt ?? 0)
  return now - since >= idleMs ? { kind: 'stop' } : { kind: 'keep', reason: 'recent-activity' }
}

/** Last time each terminal printed something, measured on the sweep's own clock. */
export class TerminalOutputQuietClock {
  private readonly seen = new Map<string, { sequence: number; since: number }>()

  /**
   * Feed the PTY's output counter; returns since when it has not moved. The first reading starts
   * the clock, so a terminal is only "quiet" for the time this process has watched it.
   */
  observe(ptyId: string, sequence: number, now: number): number {
    const last = this.seen.get(ptyId)
    if (!last || last.sequence !== sequence) {
      this.seen.set(ptyId, { sequence, since: now })
      return now
    }
    return last.since
  }

  /** Forget PTYs no longer in the inventory. */
  retain(ptyIds: ReadonlySet<string>): void {
    for (const ptyId of this.seen.keys()) {
      if (!ptyIds.has(ptyId)) {
        this.seen.delete(ptyId)
      }
    }
  }
}

function executableName(command: string): string {
  const first = command.trim().split(/\s+/, 1)[0]?.replace(/^-/, '') ?? ''
  return first.split('/').pop() ?? first
}

function isShellRow(row: ProcessTableRow): boolean {
  return isShellProcess(executableName(row.command))
}

export type AgentProcessToStop = { pid: number; command: string }

/**
 * The agent process to signal on this terminal, or null when it cannot be told apart for sure.
 * It must be in the terminal's foreground group, that group must not be the root shell's, and
 * only shells may sit between it and the pane's root (a tmux, ssh or sudo in between: hands off).
 */
export function pickAgentProcessToStop(
  rows: readonly ProcessTableRow[],
  rootPid: number,
  agentType: string
): AgentProcessToStop | null {
  const root = rows.find((row) => row.pid === rootPid)
  const foreground = root?.tpgid
  if (!root || foreground === undefined || foreground <= 0 || root.pgid === foreground) {
    return null
  }
  const front = rows.filter((row) => row.pgid === foreground)
  const agents = front.filter(
    (row) => recognizeAgentProcessFromCommandLine(row.command)?.agent === agentType
  )
  const agentPids = new Set(agents.map((row) => row.pid))
  // The outermost one: an npm agent's node wrapper, not the binary it started.
  const top = agents.filter((row) => !agentPids.has(row.ppid))
  if (top.length !== 1) {
    return null
  }
  const byPid = new Map(rows.map((row) => [row.pid, row]))
  let parent = byPid.get(top[0].ppid)
  for (let hops = 0; parent && parent.pid !== rootPid; hops += 1) {
    if (hops > 16 || !isShellRow(parent)) {
      return null
    }
    parent = byPid.get(parent.ppid)
  }
  return parent ? { pid: top[0].pid, command: top[0].command } : null
}

/** The shell holds the terminal again: nothing but shells in the foreground group. */
export function shellHoldsTerminal(rows: readonly ProcessTableRow[], rootPid: number): boolean {
  const root = rows.find((row) => row.pid === rootPid)
  const foreground = root?.tpgid
  if (!root || foreground === undefined || foreground <= 0) {
    return false
  }
  const front = rows.filter((row) => row.pgid === foreground)
  return front.length > 0 && front.every(isShellRow)
}

// Only plain words: ps prints argv without its quotes, and a re-typed command must run as it did.
const PLAIN_ARG = /^[\w@%+=:,./-]+$/

/**
 * The command that resumes this conversation, or null when the agent cannot resume by id.
 * Claude keeps the flags it was started with (say --dangerously-skip-permissions), as long as
 * the command line is plain enough to type back; anything else gets the bare resume command.
 */
export function idleAgentResumeCommand(
  agentType: string,
  providerSession: AgentProviderSessionMetadata | undefined,
  agentCommand: string | null
): string | null {
  if (!providerSession || !isResumableTuiAgent(agentType)) {
    return null
  }
  const argv = getAgentResumeArgv(agentType, providerSession)
  if (!argv || !argv.every((arg) => PLAIN_ARG.test(arg))) {
    return null
  }
  const tokens = agentCommand?.trim().split(/\s+/) ?? []
  const keepsFlags =
    agentType === 'claude' &&
    tokens.length > 0 &&
    executableName(tokens[0]) === argv[0] &&
    tokens.every((token) => PLAIN_ARG.test(token))
  const command = buildAgentResumeLaunchCommand(
    agentType,
    keepsFlags ? tokens.join(' ') : argv[0],
    argv,
    'posix'
  )
  // Every word was checked plain above, so the builder's quotes only make it harder to read.
  return command.replace(/'([\w@%+=:,./-]+)'/g, '$1')
}

const AGENT_LABELS: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
  opencode: 'OpenCode',
  cursor: 'Cursor Agent'
}

export function idleAgentLabel(agentType: string): string {
  return AGENT_LABELS[agentType] ?? agentType
}

/**
 * The line left in the terminal: it says what happened and how to come back. `typed` is whether
 * the resume command also waits at the shell prompt below it.
 */
export function idleAgentNotice(
  agentType: string,
  resumeCommand: string | null,
  typed: boolean
): string {
  const label = idleAgentLabel(agentType)
  const how = !resumeCommand
    ? 'A conversa está salva; retome pelo Histórico de Sessões de Agente.'
    : typed
      ? `A conversa está salva; para retomar, aperte Enter no comando abaixo (${resumeCommand}).`
      : `A conversa está salva; para retomar, rode: ${resumeCommand}`
  return `\r\n\x1b[33m[Orca-Pit] ${label} encerrado por ficar 2 h parado, para liberar memória. ${how}\x1b[0m\r\n`
}
