// Orca-Pit: whether this machine holds a DevNX Control session, shared by every surface that
// shows Control projects or tasks. One read per window focus; the answer rarely changes.
import { useEffect, useSyncExternalStore } from 'react'

type DevnxConnection = { connected: boolean; checking: boolean }

// Why the typeof check: the web client has no main process, and its fallback proxy for a
// missing bridge is a function, so only the real preload object counts.
export function orcaPitDevnxApi(): Window['api']['devnxControl'] | null {
  return typeof window.api?.devnxControl === 'object' ? window.api.devnxControl : null
}

let snapshot: DevnxConnection = { connected: false, checking: true }
let inflight: Promise<void> | null = null
const listeners = new Set<() => void>()

function publish(next: DevnxConnection): void {
  if (next.connected === snapshot.connected && next.checking === snapshot.checking) {
    return
  }
  snapshot = next
  for (const listener of listeners) {
    listener()
  }
}

export function refreshOrcaPitDevnxConnection(): Promise<void> {
  inflight ??= Promise.resolve()
    .then(() => orcaPitDevnxApi()?.getStatus())
    .then((status) => publish({ connected: status?.connected === true, checking: false }))
    .catch(() => publish({ connected: false, checking: false }))
    .finally(() => {
      inflight = null
    })
  return inflight
}

/** Last known answer, for non-React callers such as the Cmd+J task search. */
export function isOrcaPitDevnxConnected(): boolean {
  return snapshot.connected
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useOrcaPitDevnxConnection(): DevnxConnection {
  const read = (): DevnxConnection => snapshot
  // The server snapshot serves static renders (tests, previews): same value, nothing to hydrate.
  const value = useSyncExternalStore(subscribe, read, read)
  useEffect(() => {
    void refreshOrcaPitDevnxConnection()
    const onFocus = (): void => void refreshOrcaPitDevnxConnection()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])
  return value
}
