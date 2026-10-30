// Orca-Pit: runs this machine's managed tunnel (the one the Control created) with the pinned
// cloudflared. Restarts it with backoff when it dies and stops it with the app. A manually
// installed cloudflared service (the first tunnels, before the directory) is left alone.
import { spawn } from 'node:child_process'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { OrcaPitTunnelState } from '../../shared/orca-pit-machines'
import { ensureOrcaPitCloudflared } from './orca-pit-cloudflared-install'

export type OrcaPitTunnelProcess = {
  readonly stderr: NodeJS.ReadableStream | null
  kill: (signal?: NodeJS.Signals) => boolean
  on: (event: 'exit', listener: (code: number | null) => void) => unknown
}

export type OrcaPitCloudflaredDeps = {
  tokenFile: string
  /** Path of a verified binary (orca-pit-cloudflared-install). */
  install: () => Promise<string>
  spawnTunnel?: (binary: string, args: string[]) => OrcaPitTunnelProcess
  onState: (state: OrcaPitTunnelState) => void
  setTimer?: (callback: () => void, ms: number) => unknown
  clearTimer?: (timer: unknown) => void
  now?: () => number
}

const FIRST_RETRY_MS = 2_000
const MAX_RETRY_MS = 60_000
// Why 60 s: a tunnel that held this long was healthy; the next failure starts over from 2 s.
const HEALTHY_AFTER_MS = 60_000
const CONNECTED_LINE = /Registered tunnel connection/i

function defaultSpawn(binary: string, args: string[]): OrcaPitTunnelProcess {
  return spawn(binary, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
}

export function writeOrcaPitTunnelToken(tokenFile: string, token: string): void {
  mkdirSync(dirname(tokenFile), { recursive: true })
  writeFileSync(tokenFile, token, { mode: 0o600 })
  // Why chmod too: writeFileSync keeps the mode of a file that already existed.
  chmodSync(tokenFile, 0o600)
}

export class OrcaPitCloudflared {
  private token: string | null = null
  private child: OrcaPitTunnelProcess | null = null
  private retryTimer: unknown = null
  private retryMs = FIRST_RETRY_MS
  private startedAt = 0
  private generation = 0
  private readonly setTimer: (callback: () => void, ms: number) => unknown
  private readonly clearTimer: (timer: unknown) => void
  private readonly now: () => number

  constructor(private readonly deps: OrcaPitCloudflaredDeps) {
    this.setTimer = deps.setTimer ?? ((callback, ms) => setTimeout(callback, ms).unref())
    this.clearTimer = deps.clearTimer ?? ((timer) => clearTimeout(timer as NodeJS.Timeout))
    this.now = deps.now ?? Date.now
  }

  /** Active with this token: running, installing or waiting to retry (stop clears the token). */
  isRunningWith(token: string): boolean {
    return this.token === token
  }

  /** Starts the tunnel, or restarts it when the token changed. */
  async start(token: string): Promise<void> {
    if (this.isRunningWith(token)) {
      return
    }
    this.stop()
    this.token = token
    this.retryMs = FIRST_RETRY_MS
    await this.launch(++this.generation)
  }

  stop(): void {
    this.generation += 1
    this.token = null
    if (this.retryTimer !== null) {
      this.clearTimer(this.retryTimer)
      this.retryTimer = null
    }
    const child = this.child
    this.child = null
    child?.kill('SIGTERM')
    this.deps.onState({ kind: 'off' })
  }

  private async launch(generation: number): Promise<void> {
    const token = this.token
    if (!token || generation !== this.generation) {
      return
    }
    let binary: string
    try {
      this.deps.onState({ kind: 'installing' })
      binary = await this.deps.install()
      writeOrcaPitTunnelToken(this.deps.tokenFile, token)
    } catch (error) {
      if (generation === this.generation) {
        this.deps.onState({ kind: 'error', message: (error as Error).message })
        this.scheduleRetry(generation)
      }
      return
    }
    if (generation !== this.generation) {
      return
    }
    this.deps.onState({ kind: 'starting' })
    const args = ['tunnel', '--no-autoupdate', 'run', '--token-file', this.deps.tokenFile]
    const child = (this.deps.spawnTunnel ?? defaultSpawn)(binary, args)
    this.child = child
    this.startedAt = this.now()
    child.stderr?.on('data', (chunk: Buffer | string) => {
      if (this.child === child && CONNECTED_LINE.test(String(chunk))) {
        this.deps.onState({ kind: 'running' })
      }
    })
    child.on('exit', (code) => {
      if (this.child !== child) {
        return
      }
      this.child = null
      if (this.now() - this.startedAt >= HEALTHY_AFTER_MS) {
        this.retryMs = FIRST_RETRY_MS
      }
      this.deps.onState({
        kind: 'error',
        message: `O túnel parou (código ${code ?? 'desconhecido'}); religando.`
      })
      this.scheduleRetry(generation)
    })
  }

  private scheduleRetry(generation: number): void {
    const delay = this.retryMs
    this.retryMs = Math.min(this.retryMs * 2, MAX_RETRY_MS)
    this.retryTimer = this.setTimer(() => {
      this.retryTimer = null
      void this.launch(generation)
    }, delay)
  }
}

export function createOrcaPitCloudflared(options: {
  binDir: string
  tokenFile: string
  onState: (state: OrcaPitTunnelState) => void
}): OrcaPitCloudflared {
  return new OrcaPitCloudflared({
    tokenFile: options.tokenFile,
    onState: options.onState,
    install: () =>
      ensureOrcaPitCloudflared({
        binDir: options.binDir,
        platform: process.platform,
        arch: process.arch
      })
  })
}
