// Orca-Pit: when each terminal last received typing, for the idle-agent sweep. Kept apart and
// light (one Map, no imports) because it is fed from the keystroke hot path.

const MAX_TRACKED_PTYS = 1024

const lastInputAtByPty = new Map<string, number>()

/** A key reached this PTY (this window's typing or a remote client's stream). */
export function noteOrcaPitTerminalInput(ptyId: string, at: number = Date.now()): void {
  if (!lastInputAtByPty.has(ptyId) && lastInputAtByPty.size >= MAX_TRACKED_PTYS) {
    // Why the oldest: Map keeps insertion order, and a PTY typed into again is re-inserted below.
    const oldest = lastInputAtByPty.keys().next().value
    if (oldest !== undefined) {
      lastInputAtByPty.delete(oldest)
    }
  }
  lastInputAtByPty.delete(ptyId)
  lastInputAtByPty.set(ptyId, at)
}

/** Wall clock (ms) of the last key seen for this PTY since the app started, or null. */
export function orcaPitTerminalLastInputAt(ptyId: string): number | null {
  return lastInputAtByPty.get(ptyId) ?? null
}
