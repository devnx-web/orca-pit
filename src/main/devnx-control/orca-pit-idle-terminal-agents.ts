// Orca-Pit: stops an agent CLI left idle in an Orca terminal for two hours (pedido do dono,
// nov/2026: "Claude parado 2 horas em terminal encerra"). Orca's native chats already retire their
// agent after 30 min; a TUI in a terminal tab lived forever. Every 5 min this machine's main
// process reads the agent status rows and each pane's output counter; a pane whose turn ended and
// whose terminal saw no key and no output for two hours gets SIGTERM on the agent process only.
// The shell and the tab stay; a line in the terminal says why, and the resume command waits at
// the prompt, ready for Enter. Only this machine's PTYs on Linux/macOS: SSH panes, tmux, Windows
// and anything that cannot be told apart for sure are left alone.
import { open } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import { runProcess } from '@orca/process-host'
import { agentHookServer } from '../agent-hooks/server'
import { getLocalPtyProvider } from '../ipc/pty/provider/registry'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { readTerminalProcessRows } from '../runtime/terminal-foreground-group'
import { psLocaleEnvironment } from '../../shared/ps-locale-environment'
import { orcaPitTerminalLastInputAt } from './orca-pit-idle-terminal-input'
import { IdleTerminalAgentsSweep } from './orca-pit-idle-terminal-agents-sweep'

const SCREEN_READ_TIMEOUT_MS = 5_000

async function terminalDeviceOf(rootPid: number): Promise<string | null> {
  const result = await runProcess({
    program: 'ps',
    args: ['-o', 'tty=', '-p', String(rootPid)],
    env: psLocaleEnvironment(),
    timeoutMs: 3_000,
    maxOutputBytes: 4_096
  }).catch(() => null)
  const tty = result?.code === 0 ? result.stdout.trim() : ''
  // Linux pts/N, macOS ttysNNN; `?` is no terminal.
  return /^(?:pts\/\d+|ttys\d+)$/.test(tty) ? `/dev/${tty}` : null
}

/** Writes on the terminal's slave side: it shows as output, never as something typed. */
async function writeToTerminal(rootPid: number, text: string): Promise<void> {
  const device = await terminalDeviceOf(rootPid)
  if (!device) {
    throw new Error('terminal device not found')
  }
  const handle = await open(device, fsConstants.O_WRONLY | fsConstants.O_NOCTTY)
  try {
    await handle.write(text)
  } finally {
    await handle.close()
  }
}

/** The value, or null when it failed or took longer than `ms`. */
function withTimeout<T>(value: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms)
    timer.unref?.()
    value.then(
      (result) => {
        clearTimeout(timer)
        resolve(result)
      },
      () => {
        clearTimeout(timer)
        resolve(null)
      }
    )
  })
}

let sweep: IdleTerminalAgentsSweep | null = null

export function installOrcaPitIdleTerminalAgents(runtime: OrcaRuntimeService): void {
  // Signals and /dev/pts only exist on POSIX; Windows terminals are left as they are.
  if (sweep || process.platform === 'win32') {
    return
  }
  const log = (text: string, cause?: unknown): void =>
    console.warn(`[orca-pit] idle-agents: ${text}`, ...(cause === undefined ? [] : [cause]))
  sweep = new IdleTerminalAgentsSweep({
    statusRows: () => agentHookServer.getStatusSnapshot(),
    localPtys: () => getLocalPtyProvider().listProcesses(),
    outputSequence: (ptyId) => runtime.getPtyOutputSequence(ptyId),
    lastInputAt: orcaPitTerminalLastInputAt,
    readDraft: async (handle) => {
      const read = await withTimeout(
        runtime.readTerminal(handle, { screen: true }),
        SCREEN_READ_TIMEOUT_MS
      )
      return read ? (read.draft ?? '') : null
    },
    processRows: readTerminalProcessRows,
    signal: (pid) => process.kill(pid, 'SIGTERM'),
    writeNotice: writeToTerminal,
    typeAtPrompt: async (handle, input) => {
      await runtime.sendTerminal(handle, input, { inputKind: 'launch' })
    },
    now: Date.now,
    wait: (ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms).unref?.()
      }),
    log
  })
  sweep.start()
}
