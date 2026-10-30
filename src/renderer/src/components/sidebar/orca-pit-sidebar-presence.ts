// Orca-Pit: polls each host behind the sidebar for its people (`orcaPit.agentAuthors`): who sent
// the last command to each agent, who started it, who is looking at it and who is connected. One
// poll per host, only while something on screen reads it; rows subscribe to the slice they draw.
import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { useAppStore } from '@/store'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { getRuntimeTargetForWorktreeOwner } from '@/lib/file-owner-runtime-target'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import type { OrcaPitPaneAuthor } from '../../../../shared/orca-pit-agent-authors'
import {
  EMPTY_ORCA_PIT_HOST_PRESENCE,
  parseOrcaPitHostPresence,
  type OrcaPitHostPresence,
  type OrcaPitPerson
} from '../../../../shared/orca-pit-presence'
import { parseExecutionHostId, type ExecutionHostId } from '../../../../shared/execution-host'

const POLL_MS = 15_000
// Why: an upstream Orca host has no such method; ask it again only rarely.
const UNSUPPORTED_RETRY_MS = 10 * 60_000
const LOCAL_TARGET: RuntimeClientTarget = { kind: 'local' }

type HostPoll = {
  target: RuntimeClientTarget
  presence: OrcaPitHostPresence
  snapshot: string
  subscribers: Set<() => void>
  timer: ReturnType<typeof setInterval> | null
  retryAfter: number
}

const polls = new Map<string, HostPoll>()
const anyChangeListeners = new Set<() => void>()
let revision = 0

export function orcaPitTargetKey(target: RuntimeClientTarget): string {
  return target.kind === 'local' ? 'local' : `env:${target.environmentId}`
}

/** The host that answers for a sidebar host id: a paired server for itself, this app otherwise. */
export function orcaPitTargetForHost(hostId: ExecutionHostId): RuntimeClientTarget {
  const parsed = parseExecutionHostId(hostId)
  return parsed?.kind === 'runtime'
    ? { kind: 'environment', environmentId: parsed.environmentId }
    : LOCAL_TARGET
}

function notifyAll(poll: HostPoll): void {
  revision += 1
  for (const notify of poll.subscribers) {
    notify()
  }
  for (const notify of anyChangeListeners) {
    notify()
  }
}

async function pollHost(poll: HostPoll): Promise<void> {
  if (Date.now() < poll.retryAfter) {
    return
  }
  try {
    const result = await callRuntimeRpc<unknown>(poll.target, 'orcaPit.agentAuthors', undefined, {
      timeoutMs: 10_000,
      suppressFeatureInteraction: true
    })
    // Why compare without `now`: the central's clock moves every poll; nothing else might have.
    const snapshot = JSON.stringify(result, (key, value: unknown) =>
      key === 'now' ? undefined : value
    )
    if (snapshot !== poll.snapshot) {
      poll.presence = parseOrcaPitHostPresence(result, Date.now())
      poll.snapshot = snapshot
      notifyAll(poll)
    }
  } catch {
    poll.retryAfter = Date.now() + UNSUPPORTED_RETRY_MS
  }
}

function subscribeHost(target: RuntimeClientTarget, notify: () => void): () => void {
  const key = orcaPitTargetKey(target)
  let poll = polls.get(key)
  if (!poll) {
    poll = {
      target,
      presence: EMPTY_ORCA_PIT_HOST_PRESENCE,
      snapshot: '',
      subscribers: new Set(),
      timer: null,
      retryAfter: 0
    }
    polls.set(key, poll)
  }
  const active = poll
  active.subscribers.add(notify)
  if (!active.timer) {
    void pollHost(active)
    active.timer = setInterval(() => void pollHost(active), POLL_MS)
  }
  return () => {
    active.subscribers.delete(notify)
    if (active.subscribers.size === 0 && active.timer) {
      clearInterval(active.timer)
      active.timer = null
    }
  }
}

/** Every host's latest reply, for code outside React (keyboard order). */
export function getOrcaPitHostPresences(): OrcaPitHostPresence[] {
  return [...polls.values()].map((poll) => poll.presence)
}

export function getOrcaPitHostPresence(key: string): OrcaPitHostPresence {
  return polls.get(key)?.presence ?? EMPTY_ORCA_PIT_HOST_PRESENCE
}

function subscribeAnyChange(notify: () => void): () => void {
  anyChangeListeners.add(notify)
  return () => anyChangeListeners.delete(notify)
}

const noopUnsubscribe = (): void => {}
const subscribeNever = (): (() => void) => noopUnsubscribe
const readZero = (): number => 0
const readRevision = (): number => revision

/** Bumps whenever any host's people change; 0 while disabled, so a disabled caller never wakes. */
export function useOrcaPitPresenceRevision(enabled: boolean): number {
  return useSyncExternalStore(
    enabled ? subscribeAnyChange : subscribeNever,
    enabled ? readRevision : readZero,
    enabled ? readRevision : readZero
  )
}

function readAvatarUrl(personKey: string): string | null {
  for (const poll of polls.values()) {
    const url = poll.presence.avatars[personKey]
    if (url) {
      return url
    }
  }
  return null
}

/** A person's Control photo from any host that knows them (`u:<id>` keys are global). */
export function useOrcaPitAvatarUrl(personKey: string): string | null {
  const read = useCallback(() => readAvatarUrl(personKey), [personKey])
  return useSyncExternalStore(subscribeAnyChange, read, read)
}

function targetFromKey(key: string): RuntimeClientTarget {
  return key.startsWith('env:')
    ? { kind: 'environment', environmentId: key.slice(4) }
    : LOCAL_TARGET
}

/** Keeps the given hosts polled while mounted (the "online now" strip, the filters). */
export function useOrcaPitPolledHosts(hostIds: readonly ExecutionHostId[]): OrcaPitHostPresence[] {
  // Why a joined string: callers rebuild the host list on store updates; the polls must not churn.
  const joined = [
    ...new Set(hostIds.map((hostId) => orcaPitTargetKey(orcaPitTargetForHost(hostId))))
  ].join('\n')
  const keys = useMemo(() => (joined ? joined.split('\n') : []), [joined])
  const subscribe = useCallback(
    (notify: () => void) => {
      const stops = keys.map((key) => subscribeHost(targetFromKey(key), notify))
      return () => stops.forEach((stop) => stop())
    },
    [keys]
  )
  useSyncExternalStore(subscribe, readRevision, readRevision)
  return keys.map(getOrcaPitHostPresence)
}

function ownerTarget(worktreeId: string | null | undefined): RuntimeClientTarget | null {
  if (!worktreeId) {
    return null
  }
  try {
    return getRuntimeTargetForWorktreeOwner(useAppStore.getState(), worktreeId)
  } catch {
    // A partial store (tests, early startup) shows nothing rather than breaking the row.
    return null
  }
}

/** One host's slice for a row; the row re-renders only when `pick` returns something new. */
function useOwnerHostSlice<T>(
  worktreeId: string | null | undefined,
  pick: (presence: OrcaPitHostPresence) => T
): T {
  // Why read once: a workspace's owner host does not change while its row is mounted, and a
  // store selector here would run for every row on every store update.
  const target = useMemo(() => ownerTarget(worktreeId), [worktreeId])
  const key = target ? orcaPitTargetKey(target) : null
  const subscribe = useCallback(
    (notify: () => void) => (target ? subscribeHost(target, notify) : noopUnsubscribe),
    [target]
  )
  const read = (): T => pick(key ? getOrcaPitHostPresence(key) : EMPTY_ORCA_PIT_HOST_PRESENCE)
  return useSyncExternalStore(subscribe, read, read)
}

const NO_PEOPLE: readonly OrcaPitPerson[] = Object.freeze([])

export function useOrcaPitPaneAuthor(
  worktreeId: string | null | undefined,
  paneKey: string
): OrcaPitPaneAuthor | null {
  return useOwnerHostSlice(worktreeId, (presence) =>
    Object.hasOwn(presence.authors, paneKey) ? (presence.authors[paneKey] ?? null) : null
  )
}

export function useOrcaPitPaneViewers(
  worktreeId: string | null | undefined,
  paneKey: string
): readonly OrcaPitPerson[] {
  return useOwnerHostSlice(worktreeId, (presence) =>
    Object.hasOwn(presence.viewers, paneKey) ? (presence.viewers[paneKey] ?? NO_PEOPLE) : NO_PEOPLE
  )
}

/** Who this sidebar's reader is on the pane's host; their own initials are left out. */
export function useOrcaPitSelfKey(worktreeId: string | null | undefined): string | null {
  return useOwnerHostSlice(worktreeId, (presence) => presence.self?.key ?? null)
}

/** The machine name a host reports for itself ("" until it answers, or for an upstream host). */
export function useOrcaPitMachineName(hostId: ExecutionHostId): string {
  const target = useMemo(() => orcaPitTargetForHost(hostId), [hostId])
  const key = orcaPitTargetKey(target)
  const subscribe = useCallback((notify: () => void) => subscribeHost(target, notify), [target])
  const read = (): string => getOrcaPitHostPresence(key).machineName
  return useSyncExternalStore(subscribe, read, read)
}
