// Orca-Pit: this machine's entry in the company directory (contrato-maquinas v1). The first
// registration needs a person signed in to the app, who becomes the owner; after that the machine
// keeps its heartbeat and tunnel with its own device token, so a central that rebooted to the
// sign-in screen stays reachable. Approved by an admin, it runs the tunnel the Control created and
// tells the server which hidden host and secret the router comes in with (contrato v1.2).
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { OrcaPitMachineSelfState, OrcaPitTunnelState } from '../../shared/orca-pit-machines'
import { DevnxControlError, isRecord } from './devnx-control-http'
import type { OrcaPitCentralSession } from './orca-pit-control-me'
import {
  ORCA_PIT_MACHINE_CALLS,
  type OrcaPitMachineCalls,
  type OrcaPitMachineReply
} from './orca-pit-machines-api'
import {
  clearOrcaPitMachineSecrets,
  readOrcaPitMachineSecrets,
  writeOrcaPitMachineSecrets
} from './orca-pit-machine-secrets'

export const ORCA_PIT_HEARTBEAT_MS = 60_000

type StoredMachine = { uid: string; machineId: number | null }

export type OrcaPitMachineAgentDeps = {
  /** The machine's own Control session (base URL and device token), or null when unpaired. */
  controlSession: () => OrcaPitCentralSession | null
  /** The JWT of the person signed in to this app, or null. */
  personToken: () => string | null
  /** Where the runtime's WebSocket listens; null until it is up. */
  binding: () => { host: string; port: number } | null
  /** The runtime's E2EE public key, the one pairings pin. */
  publicKey: () => string | null
  version: () => Promise<string>
  lanEndpoints: () => string[]
  hostname: string
  platform: string
  stateFile: string
  /** 0600 file with the tunnel token and origin secret (orca-pit-machine-secrets). */
  secretsFile: string
  /** The router's hidden host and secret, for the server's origin check; null turns it off. */
  managedOrigin: (origin: { host: string; secret: string } | null) => void
  tunnel: { start: (token: string) => Promise<void>; stop: () => void }
  /** The machine was approved at this public address (`wss://orca.devnx.com.br/<slug>`). */
  onPublicUrl: (url: string) => void
  onState: (state: OrcaPitMachineSelfState) => void
  calls?: OrcaPitMachineCalls
  setTimer?: (callback: () => void, ms: number) => unknown
  clearTimer?: (timer: unknown) => void
}

function isStatus(error: unknown, ...statuses: number[]): boolean {
  return error instanceof DevnxControlError && statuses.includes(error.status ?? -1)
}

export class OrcaPitMachineAgent {
  private timer: unknown = null
  private running: Promise<void> | null = null
  private registeredThisRun = false
  private tunnelToken: string | null = null
  private originSecret: string | null = null
  private tunnelState: OrcaPitTunnelState = { kind: 'off' }
  private state: OrcaPitMachineSelfState = { kind: 'idle' }
  private readonly calls: OrcaPitMachineCalls

  constructor(private readonly deps: OrcaPitMachineAgentDeps) {
    this.calls = deps.calls ?? ORCA_PIT_MACHINE_CALLS
  }

  current(): OrcaPitMachineSelfState {
    return this.state
  }

  /** The tunnel process reports here (wired by the caller). */
  setTunnelState(tunnel: OrcaPitTunnelState): void {
    this.tunnelState = tunnel
    if (this.state.kind === 'registered') {
      this.publish({ ...this.state, tunnel })
    }
  }

  start(): void {
    if (this.timer !== null) {
      return
    }
    this.resumeFromDisk()
    const loop = (): void => {
      this.timer = (this.deps.setTimer ?? ((callback, ms) => setTimeout(callback, ms).unref()))(
        () => void this.tick().finally(loop),
        ORCA_PIT_HEARTBEAT_MS
      )
    }
    void this.tick().finally(loop)
  }

  stop(): void {
    if (this.timer !== null) {
      ;(this.deps.clearTimer ?? ((timer) => clearTimeout(timer as NodeJS.Timeout)))(this.timer)
      this.timer = null
    }
    this.deps.tunnel.stop()
  }

  /** An approved machine comes back with its last tunnel even before the Control answers. */
  private resumeFromDisk(): void {
    const secrets = readOrcaPitMachineSecrets(this.deps.secretsFile)
    if (!secrets || this.readStored().machineId === null) {
      return
    }
    this.tunnelToken = secrets.tunnelToken
    this.originSecret = secrets.originSecret
    this.deps.managedOrigin({ host: secrets.originHost, secret: secrets.originSecret })
    void this.deps.tunnel.start(secrets.tunnelToken)
  }

  /** Runs one round now (after a sign-in, for instance); concurrent calls share it. */
  tick(): Promise<void> {
    this.running ??= this.round().finally(() => {
      this.running = null
    })
    return this.running
  }

  private publish(state: OrcaPitMachineSelfState): void {
    this.state = state
    this.deps.onState(state)
  }

  private async round(): Promise<void> {
    const session = this.deps.controlSession()
    const binding = this.deps.binding()
    const publicKey = this.deps.publicKey()
    if (!session) {
      this.reset()
      return
    }
    if (!binding || !publicKey) {
      return
    }
    const stored = this.readStored()
    const personToken = this.deps.personToken()
    // Why: the owner of a new entry is the person at the app, never the pairing by default.
    if (stored.machineId === null && !personToken) {
      this.publish({ kind: 'idle' })
      return
    }
    const tokens = [personToken, session.token].filter((token): token is string => !!token)
    try {
      const reply =
        stored.machineId !== null && this.registeredThisRun
          ? await this.withTokens(tokens, async (token) =>
              this.calls.heartbeat(session.baseUrl, token, stored.machineId as number, {
                // contrato v1.1: the install's secret proves the heartbeat comes from this machine.
                machine_uid: stored.uid,
                version: await this.deps.version(),
                lan_endpoints: this.deps.lanEndpoints()
              })
            )
          : await this.register(session.baseUrl, tokens, stored.uid, binding.port, publicKey)
      this.registeredThisRun = true
      this.writeStored({ uid: stored.uid, machineId: reply.machine.id })
      await this.apply(reply)
    } catch (error) {
      if (isStatus(error, 404) && stored.machineId !== null) {
        // Removed in the Control: forget it; the next sign-in registers it again.
        this.writeStored({ uid: stored.uid, machineId: null })
        this.reset()
        return
      }
      this.publish({ kind: 'error', message: (error as Error).message })
    }
  }

  private async register(
    baseUrl: string,
    tokens: string[],
    uid: string,
    port: number,
    publicKey: string
  ): Promise<OrcaPitMachineReply> {
    this.publish({ kind: 'registering' })
    const version = await this.deps.version()
    return this.withTokens(tokens, (token) =>
      this.calls.register(baseUrl, token, {
        machine_uid: uid,
        name: this.deps.hostname,
        platform: this.deps.platform,
        version,
        local_port: port,
        public_key: publicKey
      })
    )
  }

  /** The person's JWT first; when it expired, the machine's device token. */
  private async withTokens<T>(tokens: string[], call: (token: string) => Promise<T>): Promise<T> {
    let lastError: unknown = new Error('Sem credencial do DevNX Control.')
    for (const token of tokens) {
      try {
        return await call(token)
      } catch (error) {
        lastError = error
        if (!isStatus(error, 401)) {
          throw error
        }
      }
    }
    throw lastError
  }

  private async apply(reply: OrcaPitMachineReply): Promise<void> {
    const { machine } = reply
    this.tunnelToken = reply.tunnelToken ?? this.tunnelToken
    this.originSecret = reply.originSecret ?? this.originSecret
    this.publish({ kind: 'registered', machine, tunnel: this.tunnelState })
    if (machine.status !== 'approved') {
      this.stopTunnel()
      return
    }
    this.deps.onPublicUrl(machine.publicUrl)
    const host = machine.originHost
    // Why all three: a tunnel the server would refuse (no secret to check) is worse than none.
    if (this.tunnelToken && this.originSecret && host) {
      writeOrcaPitMachineSecrets(this.deps.secretsFile, {
        tunnelToken: this.tunnelToken,
        originHost: host,
        originSecret: this.originSecret
      })
      this.deps.managedOrigin({ host, secret: this.originSecret })
      await this.deps.tunnel.start(this.tunnelToken)
    }
  }

  /** Pending, disabled, removed or unpaired: no tunnel, no origin, no secrets on disk. */
  private stopTunnel(): void {
    this.tunnelToken = null
    this.originSecret = null
    clearOrcaPitMachineSecrets(this.deps.secretsFile)
    this.deps.managedOrigin(null)
    this.deps.tunnel.stop()
  }

  private reset(): void {
    this.registeredThisRun = false
    this.stopTunnel()
    this.publish({ kind: 'idle' })
  }

  private readStored(): StoredMachine {
    try {
      const value: unknown = JSON.parse(readFileSync(this.deps.stateFile, 'utf8'))
      if (isRecord(value) && typeof value.uid === 'string' && value.uid) {
        const machineId =
          typeof value.machineId === 'number' && Number.isInteger(value.machineId)
            ? value.machineId
            : null
        return { uid: value.uid, machineId }
      }
    } catch {
      // First run: a new uid below.
    }
    const fresh = { uid: randomUUID(), machineId: null }
    this.writeStored(fresh)
    return fresh
  }

  private writeStored(stored: StoredMachine): void {
    mkdirSync(dirname(this.deps.stateFile), { recursive: true })
    writeFileSync(this.deps.stateFile, `${JSON.stringify(stored)}\n`, { mode: 0o600 })
  }
}
