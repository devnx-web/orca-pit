import { describe, expect, it } from 'vitest'
import type { AgentStatusIpcPayload } from '../../shared/agent-status-ipc-payload'
import type { ProcessTableRow } from '../../shared/process-table-snapshot'
import type { PtyProcessInfo } from '../providers/pty-process-info'
import {
  ORCA_PIT_IDLE_TERMINAL_AGENT_MS,
  TerminalOutputQuietClock,
  idleAgentNotice,
  idleAgentResumeCommand,
  judgeIdleTerminalAgent,
  pickAgentProcessToStop,
  shellHoldsTerminal,
  type IdleAgentRow
} from './orca-pit-idle-terminal-agents-rules'
import {
  IdleTerminalAgentsSweep,
  type IdleTerminalAgentsDeps
} from './orca-pit-idle-terminal-agents-sweep'

const HOUR = 60 * 60_000
const T0 = Date.UTC(2026, 10, 3, 12)

function row(overrides: Partial<IdleAgentRow> = {}): IdleAgentRow {
  return {
    paneKey: 'tab-1:leaf-1',
    state: 'done',
    stateStartedAt: T0,
    agentType: 'claude',
    ...overrides
  }
}

describe('Orca-Pit idle terminal agents: who is stopped', () => {
  it('stops a Claude whose turn ended and whose terminal was quiet for 2 h', () => {
    expect(judgeIdleTerminalAgent(row(), T0, T0 + 2 * HOUR)).toEqual({ kind: 'stop' })
    expect(ORCA_PIT_IDLE_TERMINAL_AGENT_MS).toBe(2 * HOUR)
  })

  it('stops Codex and other terminal agents by the same rule', () => {
    expect(judgeIdleTerminalAgent(row({ agentType: 'codex' }), T0, T0 + 3 * HOUR).kind).toBe('stop')
  })

  it('keeps it before the 2 h, counting from the latest key or output', () => {
    expect(judgeIdleTerminalAgent(row(), T0, T0 + 2 * HOUR - 1)).toEqual({
      kind: 'keep',
      reason: 'recent-activity'
    })
    // Turn ended long ago, but someone typed or the screen moved an hour ago.
    expect(
      judgeIdleTerminalAgent(row({ stateStartedAt: T0 - 10 * HOUR }), T0 + HOUR, T0 + 2 * HOUR).kind
    ).toBe('keep')
  })

  it('counts from the end of the turn even when the terminal was already quiet', () => {
    expect(judgeIdleTerminalAgent(row({ stateStartedAt: T0 + HOUR }), T0, T0 + 2 * HOUR).kind).toBe(
      'keep'
    )
  })

  it('never touches an agent that is working, waiting for permission or asking', () => {
    for (const state of ['working', 'blocked', 'waiting'] as const) {
      expect(judgeIdleTerminalAgent(row({ state }), T0, T0 + 10 * HOUR)).toEqual({
        kind: 'keep',
        reason: 'not-done'
      })
    }
    expect(
      judgeIdleTerminalAgent(row({ interactivePrompt: '{"questions":[]}' }), T0, T0 + 10 * HOUR)
        .kind
    ).toBe('keep')
    expect(
      judgeIdleTerminalAgent(
        row({ mainAgent: { state: 'working', stateStartedAt: T0 } }),
        T0,
        T0 + 10 * HOUR
      ).kind
    ).toBe('keep')
  })

  it('keeps an agent with a subagent or a background task still open', () => {
    const working = row({
      subagents: [{ id: 'a1', state: 'working', startedAt: T0 }]
    })
    expect(judgeIdleTerminalAgent(working, T0, T0 + 10 * HOUR)).toEqual({
      kind: 'keep',
      reason: 'background-work'
    })
    expect(
      judgeIdleTerminalAgent(row({ claudeTaskWakeupPending: 'notification' }), T0, T0 + 10 * HOUR)
        .kind
    ).toBe('keep')
    const idleChild = row({ subagents: [{ id: 'a1', state: 'idle', startedAt: T0 }] })
    expect(judgeIdleTerminalAgent(idleChild, T0, T0 + 10 * HOUR).kind).toBe('stop')
  })

  it('leaves native chats to their own 30 min rule', () => {
    expect(
      judgeIdleTerminalAgent(
        row({ paneKey: 'structured-agent-session-abc:leaf' }),
        T0,
        T0 + 10 * HOUR
      )
    ).toEqual({ kind: 'keep', reason: 'native-chat' })
  })

  it('ignores rows without an agent and resume-identity-only rows', () => {
    expect(judgeIdleTerminalAgent(row({ agentType: undefined }), T0, T0 + 10 * HOUR).kind).toBe(
      'keep'
    )
    expect(
      judgeIdleTerminalAgent(row({ providerSessionOnly: true }), T0, T0 + 10 * HOUR).kind
    ).toBe('keep')
  })
})

describe('Orca-Pit idle terminal agents: output clock', () => {
  it('measures quiet from the first reading and restarts on new output', () => {
    const clock = new TerminalOutputQuietClock()
    expect(clock.observe('p1', 10, T0)).toBe(T0)
    expect(clock.observe('p1', 10, T0 + HOUR)).toBe(T0)
    expect(clock.observe('p1', 11, T0 + 2 * HOUR)).toBe(T0 + 2 * HOUR)
    clock.retain(new Set())
    expect(clock.observe('p1', 11, T0 + 3 * HOUR)).toBe(T0 + 3 * HOUR)
  })
})

function proc(
  pid: number,
  ppid: number,
  pgid: number,
  command: string,
  tpgid?: number
): ProcessTableRow {
  return { pid, ppid, pgid, ...(tpgid === undefined ? {} : { tpgid }), stat: 'S', command }
}

describe('Orca-Pit idle terminal agents: which process gets the signal', () => {
  it('picks the agent in the foreground, never the shell', () => {
    const rows = [
      proc(100, 1, 100, '-bash', 200),
      proc(200, 100, 200, 'claude --dangerously-skip-permissions'),
      proc(201, 200, 200, 'node /tmp/mcp-server.js')
    ]
    expect(pickAgentProcessToStop(rows, 100, 'claude')).toEqual({
      pid: 200,
      command: 'claude --dangerously-skip-permissions'
    })
  })

  it('signals the outer node wrapper of an npm agent', () => {
    const rows = [
      proc(100, 1, 100, 'zsh', 300),
      proc(300, 100, 300, 'node /usr/lib/node_modules/@openai/codex/bin/codex.js'),
      proc(301, 300, 300, '/usr/lib/node_modules/@openai/codex/vendor/codex/codex')
    ]
    expect(pickAgentProcessToStop(rows, 100, 'codex')?.pid).toBe(300)
  })

  it('refuses when the shell holds the terminal or the agent is the pane root', () => {
    expect(pickAgentProcessToStop([proc(100, 1, 100, 'bash', 100)], 100, 'claude')).toBeNull()
    expect(pickAgentProcessToStop([proc(100, 1, 100, 'claude', 100)], 100, 'claude')).toBeNull()
  })

  it('refuses another agent, or a tmux/ssh between the shell and the agent', () => {
    const codex = [proc(100, 1, 100, 'bash', 200), proc(200, 100, 200, 'codex')]
    expect(pickAgentProcessToStop(codex, 100, 'claude')).toBeNull()
    const viaSsh = [
      proc(100, 1, 100, 'bash', 200),
      proc(150, 100, 200, 'ssh other-host'),
      proc(200, 150, 200, 'claude')
    ]
    expect(pickAgentProcessToStop(viaSsh, 100, 'claude')).toBeNull()
  })

  it('tells when the shell is back in front', () => {
    expect(shellHoldsTerminal([proc(100, 1, 100, '-bash', 100)], 100)).toBe(true)
    expect(
      shellHoldsTerminal([proc(100, 1, 100, 'bash', 200), proc(200, 100, 200, 'claude')], 100)
    ).toBe(false)
  })
})

describe('Orca-Pit idle terminal agents: how to come back', () => {
  const session = { key: 'session_id' as const, id: 'abc-123' }

  it('resumes Claude with the flags it was started with', () => {
    expect(idleAgentResumeCommand('claude', session, 'claude --dangerously-skip-permissions')).toBe(
      'claude --dangerously-skip-permissions --resume abc-123'
    )
    // A session it was resumed into before gives way to the current one.
    const again = idleAgentResumeCommand('claude', session, 'claude --resume old-1 --verbose')
    expect(again).toContain('--resume abc-123')
    expect(again).not.toContain('old-1')
  })

  it('falls back to the bare command when the old one cannot be typed back', () => {
    expect(
      idleAgentResumeCommand('claude', session, 'node /opt/claude-code/cli.js --model opus')
    ).toBe('claude --resume abc-123')
    expect(idleAgentResumeCommand('codex', session, 'codex --yolo')).toBe('codex resume abc-123')
  })

  it('has no command without a session id', () => {
    expect(idleAgentResumeCommand('claude', undefined, 'claude')).toBeNull()
  })

  it('says why the agent ended and how to resume', () => {
    const notice = idleAgentNotice('claude', 'claude --resume abc-123', true)
    expect(notice).toContain('Claude encerrado por ficar 2 h parado')
    expect(notice).toContain('aperte Enter')
    expect(idleAgentNotice('claude', null, false)).toContain('Histórico de Sessões de Agente')
  })
})

type Harness = {
  sweep: IdleTerminalAgentsSweep
  clock: { now: number }
  signals: number[]
  notices: string[]
  typed: { text?: string; enter?: boolean }[]
  state: HarnessState
}

type HarnessState = {
  sequence: number
  draft: string | null
  rows: ProcessTableRow[]
  /** The agent ignores SIGTERM. */
  stubborn: boolean
  typesDuringRead: boolean
}

function harness(statusRow: Partial<AgentStatusIpcPayload> = {}): Harness {
  const clock = { now: T0 }
  const signals: number[] = []
  const notices: string[] = []
  const typed: { text?: string; enter?: boolean }[] = []
  const agentRows = [
    proc(100, 1, 100, '-bash', 200),
    proc(200, 100, 200, 'claude --dangerously-skip-permissions')
  ]
  const state: HarnessState = {
    sequence: 5,
    draft: '',
    rows: agentRows,
    stubborn: false,
    typesDuringRead: false
  }
  const pty: PtyProcessInfo = {
    id: 'pty-1',
    cwd: '/repo',
    title: 'claude',
    paneKey: 'tab-1:leaf-1',
    terminalHandle: 'term_1',
    rootProcessId: 100
  }
  const deps: IdleTerminalAgentsDeps = {
    statusRows: () => [
      {
        paneKey: 'tab-1:leaf-1',
        state: 'done',
        prompt: '',
        stateStartedAt: T0 - 5 * HOUR,
        agentType: 'claude',
        connectionId: null,
        receivedAt: T0 - 5 * HOUR,
        providerSession: { key: 'session_id', id: 'abc-123' },
        ...statusRow
      }
    ],
    localPtys: async () => [pty],
    outputSequence: () => state.sequence,
    lastInputAt: () => null,
    readDraft: async () => {
      // Someone is typing while the screen is read.
      if (state.typesDuringRead) {
        state.sequence += 1
      }
      return state.draft
    },
    processRows: async () => state.rows,
    signal: (pid) => {
      signals.push(pid)
      if (!state.stubborn) {
        state.rows = [proc(100, 1, 100, '-bash', 100)]
      }
    },
    writeNotice: async (_root, text) => {
      notices.push(text)
    },
    typeAtPrompt: async (_handle, input) => {
      typed.push(input)
    },
    now: () => clock.now,
    wait: async (ms) => {
      clock.now += ms
    },
    log: () => {}
  }
  return { sweep: new IdleTerminalAgentsSweep(deps), clock, signals, notices, typed, state }
}

describe('Orca-Pit idle terminal agents: the sweep', () => {
  it('waits 2 h of its own watching, then stops the agent and leaves the resume at the prompt', async () => {
    const h = harness()
    await h.sweep.tick()
    expect(h.signals).toEqual([])
    h.clock.now += 2 * HOUR
    await h.sweep.tick()
    expect(h.signals).toEqual([200])
    expect(h.notices).toHaveLength(1)
    expect(h.notices[0]).toContain('aperte Enter')
    expect(h.typed).toEqual([
      { enter: true },
      { text: 'claude --dangerously-skip-permissions --resume abc-123' }
    ])
  })

  it('output in between restarts the clock', async () => {
    const h = harness()
    await h.sweep.tick()
    h.clock.now += HOUR
    h.state.sequence += 1
    await h.sweep.tick()
    h.clock.now += HOUR + 30 * 60_000
    await h.sweep.tick()
    expect(h.signals).toEqual([])
  })

  it('keeps an agent holding unsent text, or whose screen cannot be read', async () => {
    const withDraft = harness()
    withDraft.state.draft = 'meio escrito'
    await withDraft.sweep.tick()
    withDraft.clock.now += 3 * HOUR
    await withDraft.sweep.tick()
    expect(withDraft.signals).toEqual([])

    const unreadable = harness()
    unreadable.state.draft = null
    await unreadable.sweep.tick()
    unreadable.clock.now += 3 * HOUR
    await unreadable.sweep.tick()
    expect(unreadable.signals).toEqual([])
  })

  it('does not touch a waiting agent or a pane whose foreground is not the agent', async () => {
    const waiting = harness({ state: 'waiting' })
    await waiting.sweep.tick()
    waiting.clock.now += 3 * HOUR
    await waiting.sweep.tick()
    expect(waiting.signals).toEqual([])

    const shellOnly = harness()
    shellOnly.state.rows = [proc(100, 1, 100, '-bash', 100)]
    await shellOnly.sweep.tick()
    shellOnly.clock.now += 3 * HOUR
    await shellOnly.sweep.tick()
    expect(shellOnly.signals).toEqual([])
  })

  it('signals once per idle turn even if the agent ignores it', async () => {
    const h = harness()
    h.state.stubborn = true
    await h.sweep.tick()
    h.clock.now += 3 * HOUR
    await h.sweep.tick()
    await h.sweep.tick()
    expect(h.signals).toEqual([200])
    expect(h.notices).toEqual([])
  })

  it('calls it off when the terminal moves while it is being checked', async () => {
    const h = harness()
    await h.sweep.tick()
    h.clock.now += 3 * HOUR
    h.state.typesDuringRead = true
    await h.sweep.tick()
    expect(h.signals).toEqual([])
  })
})
