import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  isAiVaultScanCancelledError,
  type AiVaultListResult,
  type AiVaultSession
} from '../../../../shared/ai-vault-types'
import { describeAiVaultScanError } from '../../../../shared/ai-vault-scan-error-message'
import {
  ALL_EXECUTION_HOSTS_SCOPE,
  requestedExecutionHostScope,
  type ExecutionHostScope
} from '../../../../shared/execution-host'
import { useAppStore } from '@/store'
import type { AiVaultSessionLimit } from './ai-vault-session-limit'
import { AiVaultSessionPublicationGate } from './ai-vault-session-publication-gate'
import { EMPTY_AI_VAULT_SESSIONS } from './ai-vault-session-identity'
import { useAppliedAiVaultScan } from './ai-vault-applied-scan'
import {
  aiVaultSessionResultCacheKey,
  resetAiVaultSessionResultCacheForTest
} from './ai-vault-session-result-cache'
import {
  refreshAiVaultSessionList,
  type AiVaultConditionalSnapshot,
  cacheAiVaultSessionList,
  readCachedAiVaultSessionList
} from './ai-vault-session-list-request'
import { resetAgentSessionIdsRefreshKeys } from './ai-vault-agent-session-refresh-key'
import { createBrowserUuid } from '@/lib/browser-uuid'
import {
  claimAiVaultForcedRescan,
  resetAiVaultForcedRescanBudgetForTest,
  useAiVaultNewSessionRescan
} from './ai-vault-new-session-rescan'

export { claimAiVaultForcedRescan }

export function resetAiVaultForcedRescanThrottleForTest(): void {
  resetAiVaultForcedRescanBudgetForTest()
  resetAgentSessionIdsRefreshKeys()
  resetAiVaultSessionResultCacheForTest()
}

// Desktop IPC reports cancellation as a result, but the web/runtime RPC path
// still rejects, so both shapes have to be recognised.
export const isAiVaultScanCancellation = isAiVaultScanCancelledError

type AiVaultRefreshArgs = { force?: boolean; background?: boolean; reuseLoadedDepth?: boolean }

// Shares main's request resolver, so this is exactly the scope that fans out on
// the desktop IPC path. Deliberately over-inclusive: the paired web transport
// drops the scope and serves one host, so 'all' there costs a redundant
// reconcile. Erring the other way would re-enable the stamp fast-path on a real
// merge, which is the bug this guard exists to prevent.
function isMergedAiVaultHostScope(scope: ExecutionHostScope): boolean {
  return requestedExecutionHostScope(scope) === ALL_EXECUTION_HOSTS_SCOPE
}

export function useAiVaultSessionRefresh(
  scopePaths: readonly string[],
  executionHostScope: ExecutionHostScope,
  sessionLimit: AiVaultSessionLimit
): {
  error: string | null
  loading: boolean
  refresh: (args?: AiVaultRefreshArgs) => Promise<void>
  scanResult: AiVaultListResult | null
  sessions: readonly AiVaultSession[]
  /** The depth the sessions on screen came from, which trails the selected one during a rescan. */
  loadedSessionLimit: AiVaultSessionLimit | null
} {
  const { scan, applyScan } = useAppliedAiVaultScan()
  const scanResult = scan?.result ?? null
  const sessions = scanResult?.sessions ?? EMPTY_AI_VAULT_SESSIONS
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestTokenRef = useRef<string>(undefined!)
  requestTokenRef.current ??= createBrowserUuid()
  const refreshIdRef = useRef(0)
  const refreshInFlightRef = useRef(false)
  const pendingRefreshRef = useRef(false)
  const pendingForceRef = useRef(false)
  const pendingBackgroundRef = useRef(true)
  const lastAppliedScanRef = useRef<{ scopeKey: string; scannedAt: string } | null>(null)
  const conditionalSnapshotRef = useRef<(AiVaultConditionalSnapshot & { scopeKey: string }) | null>(
    null
  )
  const mountedRef = useRef(true)
  const publicationGateRef = useRef<AiVaultSessionPublicationGate>(undefined!)
  publicationGateRef.current ??= new AiVaultSessionPublicationGate()
  const scanScopeKey = `${aiVaultSessionResultCacheKey(executionHostScope, scopePaths)}\n${sessionLimit}`
  const scopePathsRef = useRef<readonly string[]>(scopePaths)
  scopePathsRef.current = scopePaths
  const executionHostScopeRef = useRef<ExecutionHostScope>(executionHostScope)
  executionHostScopeRef.current = executionHostScope
  const sessionLimitRef = useRef(sessionLimit)
  // Keep render pure for React Doctor; layout effect still lands before refresh effects.
  useLayoutEffect(() => {
    sessionLimitRef.current = sessionLimit
  }, [sessionLimit])
  const currentScanScopeKey = useCallback(
    () =>
      `${aiVaultSessionResultCacheKey(
        executionHostScopeRef.current,
        scopePathsRef.current
      )}\n${sessionLimitRef.current}`,
    []
  )
  const refresh = useCallback(
    async (args: AiVaultRefreshArgs = {}): Promise<void> => {
      const hostScope = executionHostScopeRef.current
      const selectedLimit = sessionLimitRef.current
      const baseKey = aiVaultSessionResultCacheKey(hostScope, scopePathsRef.current)
      const cachedResult =
        args.reuseLoadedDepth === true
          ? readCachedAiVaultSessionList({
              scopePaths: scopePathsRef.current,
              executionHostScope: hostScope,
              sessionLimit: selectedLimit
            })
          : null
      if (cachedResult) {
        const scanKey = `${baseKey}\n${selectedLimit}`
        lastAppliedScanRef.current = { scopeKey: scanKey, scannedAt: cachedResult.scannedAt }
        setError(null)
        publicationGateRef.current.publish(cachedResult, (published) => {
          applyScan(published, selectedLimit, (applied) => {
            conditionalSnapshotRef.current = published.fingerprint
              ? { scopeKey: scanKey, fingerprint: published.fingerprint, result: applied }
              : null
          })
        })
        setLoading(false)
        return
      }
      // A scope change during an in-flight scan must not be dropped; queue one more
      // scan so the current scoped view is refreshed after the older scan settles.
      if (refreshInFlightRef.current) {
        pendingRefreshRef.current = true
        pendingForceRef.current ||= args.force === true
        pendingBackgroundRef.current &&= args.background === true
        return
      }

      refreshInFlightRef.current = true
      const refreshId = refreshIdRef.current + 1
      refreshIdRef.current = refreshId
      // A manual force scan counts against the throttle so an auto rescan right
      // after the button press doesn't trigger a second full scan.
      if (args.force === true) {
        claimAiVaultForcedRescan(true)
      }
      // Background (refocus) refreshes usually resolve from the main-process
      // cache; suppressing the loading flag avoids a spinner flash on every
      // return to the app.
      if (args.background !== true) {
        setLoading(true)
      }
      setError(null)
      const scanKey = `${baseKey}\n${selectedLimit}`
      const request = {
        scopePaths: scopePathsRef.current,
        executionHostScope: hostScope,
        sessionLimit: selectedLimit
      }
      try {
        const previous = conditionalSnapshotRef.current
        const result = await refreshAiVaultSessionList(
          request,
          { force: args.force, requestToken: requestTokenRef.current },
          previous?.scopeKey === scanKey ? previous : undefined
        )
        // A superseded scan resolves cancelled rather than rejecting, so the
        // main-process log stays clean; its empty body must not be painted.
        if (result.cancelled || !mountedRef.current || refreshIdRef.current !== refreshId) {
          return
        }
        // Why: host/scope changes queue a follow-up scan, but the older result
        // may resolve first and must not briefly paint the wrong history list.
        if (scanKey !== currentScanScopeKey()) {
          return
        }
        // A cache hit returns the snapshot already on screen; skip the state
        // updates so refocus flips don't force pointless re-renders.
        // Single-host results carry one scanner's stamp minted when that scan
        // finished, so an equal stamp does mean equal content. An 'all' result
        // is a merge of legs on independent clocks stamped with the newest leg,
        // so a lagging host's leg can change while the merged stamp stands
        // still — there, only the structural reconcile below may decide.
        if (
          !isMergedAiVaultHostScope(hostScope) &&
          lastAppliedScanRef.current?.scopeKey === scanKey &&
          lastAppliedScanRef.current.scannedAt === result.scannedAt &&
          result.fingerprint === undefined
        ) {
          return
        }
        lastAppliedScanRef.current = { scopeKey: scanKey, scannedAt: result.scannedAt }
        cacheAiVaultSessionList(request, result, { replaceHostEntries: args.force === true })
        publicationGateRef.current.publish(result, (published) => {
          if (mountedRef.current && scanKey === currentScanScopeKey()) {
            applyScan(published, selectedLimit, (applied) => {
              conditionalSnapshotRef.current = published.fingerprint
                ? { scopeKey: scanKey, fingerprint: published.fingerprint, result: applied }
                : null
            })
          }
        })
      } catch (err) {
        // A cancelled scan is not a failure: another caller's forced refresh
        // preempts the shared scan, and painting its abort would replace the
        // list with an error the incoming scan is about to make obsolete.
        if (
          !isAiVaultScanCancellation(err) &&
          mountedRef.current &&
          refreshIdRef.current === refreshId &&
          scanKey === currentScanScopeKey()
        ) {
          setError(describeAiVaultScanError(err instanceof Error ? err.message : String(err)))
        }
      } finally {
        refreshInFlightRef.current = false
        if (mountedRef.current && refreshIdRef.current === refreshId) {
          setLoading(false)
        }
        if (pendingRefreshRef.current && mountedRef.current) {
          pendingRefreshRef.current = false
          const force = pendingForceRef.current
          // The queued refresh is background-only if every queued caller was.
          const background = pendingBackgroundRef.current
          pendingForceRef.current = false
          pendingBackgroundRef.current = true
          void refresh({ force, background })
        }
      }
      // Deps intentionally avoid changing scope values: refresh reads them
      // through refs and recurses on itself, so its identity must stay stable.
    },
    [applyScan, currentScanScopeKey]
  )

  useEffect(() => {
    mountedRef.current = true
    const requestToken = requestTokenRef.current
    const publicationGate = publicationGateRef.current
    return () => {
      mountedRef.current = false
      publicationGate.cancel()
      refreshIdRef.current += 1
      refreshInFlightRef.current = false
      void window.api.aiVault.cancelListSessions({
        requestToken
      })
    }
  }, [])

  // Panel entry reuses the renderer result first, then the host scan cache.
  useEffect(() => {
    publicationGateRef.current.cancel()
    if (refreshInFlightRef.current) {
      void window.api.aiVault.cancelListSessions({
        requestToken: requestTokenRef.current
      })
    }
    void refresh({ force: false, reuseLoadedDepth: true })
  }, [executionHostScope, refresh, scanScopeKey])

  // Why: this panel can query the relay before it is ready — at startup, and again for the window
  // in which a reconnect leaves the session not-ready — and the query throws 'SSH relay is not
  // ready'. Nothing else here retries: the remaining triggers are mount, window refocus and a new
  // agent session id, so a user whose workspace is otherwise working sits on that error
  // indefinitely. The file explorer already recovers this way for the same reason
  // (use-file-explorer-tree-load-effects.ts); this panel simply never did.
  //
  // Gated on a prior error so a local workspace, or one that already listed fine, does not rescan
  // every time some other host connects.
  const sshConnectedGeneration = useAppStore((s) => s.sshConnectedGeneration)
  const sshGenerationRef = useRef(sshConnectedGeneration)
  useEffect(() => {
    if (sshConnectedGeneration <= sshGenerationRef.current) {
      return
    }
    sshGenerationRef.current = sshConnectedGeneration
    if (error !== null) {
      void refresh({ background: true, force: false })
    }
  }, [sshConnectedGeneration, error, refresh])

  // Refocus checks the shared host cache without forcing another transcript scan.
  useEffect(() => {
    const onRefocus = (): void => {
      if (document.visibilityState !== 'visible') {
        return
      }
      void refresh({ background: true, force: false })
    }
    const unsubscribeWindowFocus = window.api.aiVault.onWindowFocused?.(onRefocus)
    document.addEventListener('visibilitychange', onRefocus)
    return () => {
      unsubscribeWindowFocus?.()
      document.removeEventListener('visibilitychange', onRefocus)
    }
  }, [refresh])

  useAiVaultNewSessionRescan(refresh)

  return { error, loading, refresh, scanResult, sessions, loadedSessionLimit: scan?.limit ?? null }
}
