// Orca-Pit: what the runtime server already knows about who is connected and what each
// connection has on screen, kept where the sidebar's presence can read it. Light on purpose:
// Orca's socket and terminal-stream code call in here on every connect and subscribe.
import type { RpcCallerIdentity } from '../runtime/rpc/rpc-caller-identity'

type LiveConnection = { deviceId: string; since: number }

/** A terminal.multiplex connection, as far as presence reads it (TerminalMultiplexConnection). */
export type OrcaPitMultiplexView = {
  closed: boolean
  streams: ReadonlyMap<number, { ptyId: string; outputPaused: boolean }>
}

export type OrcaPitViewedPty = { ptyId: string; caller: RpcCallerIdentity | undefined }

const connections = new Map<string, LiveConnection>()
const multiplexes = new Map<OrcaPitMultiplexView, RpcCallerIdentity | undefined>()

/** An authenticated socket of a paired device (browser, desktop, phone) came up. */
export function noteOrcaPitConnection(
  connectionId: string,
  deviceId: string,
  now: number = Date.now()
): void {
  if (!connections.has(connectionId)) {
    connections.set(connectionId, { deviceId, since: now })
  }
}

export function forgetOrcaPitConnection(connectionId: string): void {
  connections.delete(connectionId)
}

/** Live sockets, one entry per socket; a device with two tabs open shows twice. */
export function liveOrcaPitConnections(): LiveConnection[] {
  return [...connections.values()]
}

function pruneClosedMultiplexes(): void {
  for (const view of multiplexes.keys()) {
    if (view.closed) {
      multiplexes.delete(view)
    }
  }
}

export function trackOrcaPitMultiplex(
  view: OrcaPitMultiplexView,
  caller: RpcCallerIdentity | undefined
): void {
  // Why prune here too: with nobody polling presence, closed connections would pile up.
  pruneClosedMultiplexes()
  multiplexes.set(view, caller)
}

/**
 * Terminals a remote client has on screen. A client pauses a stream's output while its pane is
 * hidden (another tab, another workspace), so a subscribed, unpaused stream is a pane in view.
 */
export function viewedOrcaPitPtys(): OrcaPitViewedPty[] {
  pruneClosedMultiplexes()
  const out: OrcaPitViewedPty[] = []
  for (const [view, caller] of multiplexes) {
    if (caller?.kind !== 'paired-device') {
      continue
    }
    for (const stream of view.streams.values()) {
      if (!stream.outputPaused) {
        out.push({ ptyId: stream.ptyId, caller })
      }
    }
  }
  return out
}

export function resetOrcaPitPresenceRegistryForTest(): void {
  connections.clear()
  multiplexes.clear()
}
