import { useCallback, useEffect, useRef } from 'react'
import { useAppStore } from '@/store'
import { getAgentSessionIdsKey } from './ai-vault-agent-session-refresh-key'

// In-app session creation bypasses the cache so the new session appears promptly.
// Keep the budget at module scope so tab remounts cannot amplify full scans.
const FORCED_RESCAN_MIN_INTERVAL_MS = 30_000
let lastForcedRescanAt = 0
// The live sessions the last automatic forced rescan was taken for; another mounted panel that sees
// the same ones reads that scan's result instead of forcing a second one.
let autoRescanSessionIdsKey = ''

/** Takes the shared forced-rescan budget when it is free. Every caller outside the panel that forces
 *  a scan must take it too, or it would amplify full scans the same way. A user's explicit request
 *  takes it even when spent, as the panel's Refresh does, so no automatic rescan follows it. */
export function claimAiVaultForcedRescan(userRequested = false): boolean {
  const now = Date.now()
  if (!userRequested && lastForcedRescanAt + FORCED_RESCAN_MIN_INTERVAL_MS > now) {
    return false
  }
  lastForcedRescanAt = now
  return true
}

export function resetAiVaultForcedRescanBudgetForTest(): void {
  lastForcedRescanAt = 0
  autoRescanSessionIdsKey = ''
}

/**
 * Sessions started inside Orca never blur the window, so refocus alone can't surface them. Agent
 * hooks already report provider sessions; re-scan only when a session id we haven't seen appears —
 * state transitions are deliberately ignored, they fire constantly while agents work.
 */
export function useAiVaultNewSessionRescan(
  refresh: (args: { background: true; force: boolean }) => Promise<void>
): void {
  // Forced rescans run immediately when the throttle allows, otherwise once as soon as it frees
  // up — dropping the event would leave a just-started session invisible until some unrelated
  // later trigger.
  const forcedRescanTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sessionIdsKeyRef = useRef('')
  const requestForcedRescan = useCallback(
    (budgetFreed = false) => {
      if (sessionIdsKeyRef.current === autoRescanSessionIdsKey) {
        if (budgetFreed) {
          void refresh({ background: true, force: false })
          return
        }
      } else if (claimAiVaultForcedRescan()) {
        autoRescanSessionIdsKey = sessionIdsKeyRef.current
        void refresh({ background: true, force: true })
        return
      }
      const waitMs = lastForcedRescanAt + FORCED_RESCAN_MIN_INTERVAL_MS - Date.now()
      if (forcedRescanTimerRef.current !== null) {
        return
      }
      forcedRescanTimerRef.current = setTimeout(() => {
        forcedRescanTimerRef.current = null
        requestForcedRescan(true)
      }, waitMs)
    },
    [refresh]
  )
  useEffect(
    () => () => {
      if (forcedRescanTimerRef.current !== null) {
        clearTimeout(forcedRescanTimerRef.current)
        forcedRescanTimerRef.current = null
      }
    },
    []
  )

  const agentSessionIdsKey = useAppStore((s) => getAgentSessionIdsKey(s.agentStatusByPaneKey))
  const seenAgentSessionIdsRef = useRef<Set<string> | null>(null)
  useEffect(() => {
    const ids = agentSessionIdsKey === '' ? [] : agentSessionIdsKey.split('\n')
    // The mount refresh already covers sessions live at mount time.
    if (seenAgentSessionIdsRef.current === null) {
      seenAgentSessionIdsRef.current = new Set(ids)
      return
    }
    const seen = seenAgentSessionIdsRef.current
    const freshIds = ids.filter((id) => !seen.has(id))
    if (freshIds.length === 0) {
      return
    }
    for (const id of freshIds) {
      seen.add(id)
    }
    sessionIdsKeyRef.current = agentSessionIdsKey
    requestForcedRescan()
  }, [agentSessionIdsKey, requestForcedRescan])
}
