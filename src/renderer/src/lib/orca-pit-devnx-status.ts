// Orca-Pit: whether a host can read the DevNX Control for this client, shared by every surface
// that shows Control projects or tasks. One status call per host and window focus; the answer
// (session present, whose login reads, may this person change a link) rarely changes.
import { useEffect, useSyncExternalStore } from 'react'
import type { RuntimeClientTarget } from '../../../shared/runtime-client-target'
import type { OrcaPitDevnxErrorCode, OrcaPitDevnxStatus } from '../../../shared/orca-pit-devnx-rpc'
import { translate } from '@/i18n/i18n'
import { devnxTargetKey, devnxTargetOfKey, fetchDevnxStatus } from '@/runtime/orca-pit-devnx-client'

export type DevnxConnection = OrcaPitDevnxStatus & { checking: boolean }

type HostEntry = {
  target: RuntimeClientTarget
  snapshot: DevnxConnection
  inflight: Promise<void> | null
}

const CHECKING: DevnxConnection = {
  connected: false,
  viewer: null,
  needsLogin: false,
  canLink: false,
  checking: true
}
const NO_HOST: DevnxConnection = { ...CHECKING, checking: false }

const hosts = new Map<string, HostEntry>()
const listeners = new Set<() => void>()

function entryFor(target: RuntimeClientTarget): HostEntry {
  const key = devnxTargetKey(target)
  let entry = hosts.get(key)
  if (!entry) {
    entry = { target, snapshot: CHECKING, inflight: null }
    hosts.set(key, entry)
  }
  return entry
}

function sameConnection(a: DevnxConnection, b: DevnxConnection): boolean {
  return (
    a.connected === b.connected &&
    a.checking === b.checking &&
    a.viewer === b.viewer &&
    a.needsLogin === b.needsLogin &&
    a.canLink === b.canLink
  )
}

function publish(entry: HostEntry, next: DevnxConnection): void {
  if (sameConnection(entry.snapshot, next)) {
    return
  }
  entry.snapshot = next
  for (const listener of listeners) {
    listener()
  }
}

function refreshHost(entry: HostEntry): Promise<void> {
  entry.inflight ??= fetchDevnxStatus(entry.target)
    .then((status) => publish(entry, { ...status, checking: false }))
    .finally(() => {
      entry.inflight = null
    })
  return entry.inflight
}

/** Re-asks every host already asked (after a sign-in or sign-out in Settings → Accounts). */
export function refreshOrcaPitDevnxConnection(): Promise<void> {
  return Promise.all([...hosts.values()].map(refreshHost)).then(() => undefined)
}

/** Last known answer for a host, for non-React callers such as the Cmd+J task search. */
export function peekOrcaPitDevnxConnection(target: RuntimeClientTarget): DevnxConnection | null {
  return hosts.get(devnxTargetKey(target))?.snapshot ?? null
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The host's answer; a null target (an unroutable project) is never connected. */
export function useOrcaPitDevnxConnection(target: RuntimeClientTarget | null): DevnxConnection {
  const key = target ? devnxTargetKey(target) : null
  const read = (): DevnxConnection => (key ? (hosts.get(key)?.snapshot ?? CHECKING) : NO_HOST)
  // The server snapshot serves static renders (tests, previews): same value, nothing to hydrate.
  const value = useSyncExternalStore(subscribe, read, read)
  // Why by key: a new target object for the same host must not ask again.
  useEffect(() => {
    if (!key) {
      return
    }
    const entry = entryFor(devnxTargetOfKey(key))
    void refreshHost(entry)
    const onFocus = (): void => void refreshHost(entry)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [key])
  return value
}

/** This app's own DevNX Control sign-in (Settings → Accounts); the web client has none. */
export function hasLocalDevnxControlBridge(): boolean {
  // Why the typeof check: the web client's fallback proxy for a missing bridge is a function.
  return typeof window.api?.devnxControl === 'object'
}

/** What a failed read shows: an expired personal login asks to sign in again. */
export function devnxFailureText(result: { code: OrcaPitDevnxErrorCode; error: string }): string {
  if (result.code === 'relogin') {
    return translate(
      'devnx.signInAgain',
      'Your DevNX Control sign-in has ended. Sign in again to see its projects and tasks.'
    )
  }
  return result.error || translate('devnx.unavailable', 'DevNX Control did not answer.')
}
