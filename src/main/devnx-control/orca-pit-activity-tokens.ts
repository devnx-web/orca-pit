// Orca-Pit: tokens a provider session spent, read from Orca's own usage stores (the same
// numbers the Usage pane shows). Best effort: an agent without a store, or a session the scan
// has not reached yet, reports no tokens instead of a guess.
import { mainProcessState as state } from '../startup/main-process-state'

export type OrcaPitTokenTotals = { tokensIn: number; tokensOut: number }

type SessionUsageRow = { sessionId: string; inputTokens: number; outputTokens: number }

type SessionUsageSource = {
  getRecentSessions(scope: 'all', range: '7d', limit: number): Promise<SessionUsageRow[]>
}

// Why 200: a stop looks up one session among the most recent; the stores cap their own work.
const RECENT_SESSION_LIMIT = 200
const LOOKUP_TIMEOUT_MS = 10_000

function sourceFor(agent: string): SessionUsageSource | null {
  if (agent === 'claude') {
    return state.claudeUsage
  }
  if (agent === 'codex') {
    return state.codexUsage
  }
  if (agent === 'opencode') {
    return state.openCodeUsage
  }
  return null
}

export async function providerSessionTotals(
  agent: string | null,
  providerSessionId: string | null,
  source: SessionUsageSource | null = agent ? sourceFor(agent) : null
): Promise<OrcaPitTokenTotals | null> {
  if (!source || !providerSessionId) {
    return null
  }
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), LOOKUP_TIMEOUT_MS)
    timer.unref?.()
  })
  try {
    const rows = await Promise.race([
      source.getRecentSessions('all', '7d', RECENT_SESSION_LIMIT),
      timeout
    ])
    const row = rows?.find((candidate) => candidate.sessionId === providerSessionId)
    return row ? { tokensIn: row.inputTokens, tokensOut: row.outputTokens } : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** What this stop adds over what earlier stops of the same session already reported. */
export function tokenDelta(
  totals: OrcaPitTokenTotals,
  baseline: OrcaPitTokenTotals
): OrcaPitTokenTotals {
  return {
    tokensIn: Math.max(0, totals.tokensIn - baseline.tokensIn),
    tokensOut: Math.max(0, totals.tokensOut - baseline.tokensOut)
  }
}
