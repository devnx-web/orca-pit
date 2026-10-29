// Orca-Pit: polls who sent the last command to each agent pane. One poll per host that owns
// a visible row, only while some row is mounted; the reply is a small map kept in memory.
import { useCallback, useMemo, useSyncExternalStore } from 'react'
import { useAppStore } from '@/store'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { getRuntimeTargetForWorktreeOwner } from '@/lib/file-owner-runtime-target'
import type { RuntimeClientTarget } from '../../../../shared/runtime-client-target'
import {
  orcaPitAgentAuthorLabel,
  parseOrcaPitAgentAuthors,
  type OrcaPitAgentAuthors
} from '../../../../shared/orca-pit-agent-authors'

const POLL_MS = 15_000
// Why: an upstream Orca host has no such method; ask it again only rarely.
const UNSUPPORTED_RETRY_MS = 10 * 60_000

type HostPoll = {
  target: RuntimeClientTarget
  authors: OrcaPitAgentAuthors
  snapshot: string
  subscribers: Set<() => void>
  timer: ReturnType<typeof setInterval> | null
  retryAfter: number
}

const polls = new Map<string, HostPoll>()
const EMPTY: OrcaPitAgentAuthors = {}

function targetKey(target: RuntimeClientTarget): string {
  return target.kind === 'local' ? 'local' : `env:${target.environmentId}`
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
    const authors = parseOrcaPitAgentAuthors(result)
    const snapshot = JSON.stringify(authors)
    if (snapshot !== poll.snapshot) {
      poll.authors = authors
      poll.snapshot = snapshot
      for (const notify of poll.subscribers) {
        notify()
      }
    }
  } catch {
    poll.retryAfter = Date.now() + UNSUPPORTED_RETRY_MS
  }
}

function subscribeHost(target: RuntimeClientTarget, notify: () => void): () => void {
  const key = targetKey(target)
  let poll = polls.get(key)
  if (!poll) {
    poll = {
      target,
      authors: EMPTY,
      snapshot: '{}',
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

const noopUnsubscribe = (): void => {}

function ownerTarget(worktreeId: string | null | undefined): RuntimeClientTarget | null {
  if (!worktreeId) {
    return null
  }
  try {
    return getRuntimeTargetForWorktreeOwner(useAppStore.getState(), worktreeId)
  } catch {
    // A partial store (tests, early startup) shows no name rather than breaking the row.
    return null
  }
}

/** First name of whoever sent the last command to this pane, or null. */
export function useOrcaPitAgentAuthor(
  worktreeId: string | null | undefined,
  paneKey: string
): string | null {
  // Why read once: a workspace's owner host does not change while its row is mounted, and a
  // store selector here would run for every row on every store update.
  const target = useMemo(() => ownerTarget(worktreeId), [worktreeId])
  const key = target ? targetKey(target) : null
  const subscribe = useCallback(
    (notify: () => void) => (target ? subscribeHost(target, notify) : noopUnsubscribe),
    [target]
  )
  // The label is the snapshot, so a row re-renders only when its own name changes.
  const read = (): string | null =>
    key ? orcaPitAgentAuthorLabel(polls.get(key)?.authors, paneKey) : null
  return useSyncExternalStore(subscribe, read, read)
}
