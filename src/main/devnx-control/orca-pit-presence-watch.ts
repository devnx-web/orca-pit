// Orca-Pit: the "time clock" of the app. After 10 minutes without anyone touching the computer
// the app covers the screen with "Are you still there?"; continuing needs no password (the
// session is still in memory), but it tells the diary when the person stopped and came back.
// The Control's workload turns those events into hours in front of the machine.
import type { OrcaPitPresenceAction } from './orca-pit-activity-types'

// Why 10 min: the length Fabio chose for "stepped away"; long enough for a phone call at the
// desk, short enough that a lunch break is not counted as work. Not an env: it is a rule.
export const ORCA_PIT_IDLE_LIMIT_MS = 10 * 60_000
// Why 30 s: the screen may come up at most half a minute late; checking costs one syscall.
const CHECK_EVERY_MS = 30_000

export type OrcaPitPresenceWatchDeps = {
  /** Seconds since the last keyboard or mouse input anywhere on the computer. */
  idleSeconds: () => number
  isSignedIn: () => boolean
  isAway: () => boolean
  markAway: (sinceMs: number) => void
  record: (action: OrcaPitPresenceAction, atMs: number) => void
  /** Pushes the new session state to the windows. */
  notify: () => void
  now?: () => number
}

export class OrcaPitPresenceWatch {
  private timer: ReturnType<typeof setInterval> | null = null
  /** When the computer went to sleep or the screen locked; null while in use. */
  private pausedAt: number | null = null
  private readonly now: () => number

  constructor(private readonly deps: OrcaPitPresenceWatchDeps) {
    this.now = deps.now ?? Date.now
  }

  start(): void {
    if (this.timer) {
      return
    }
    this.timer = setInterval(() => this.check(), CHECK_EVERY_MS)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  check(): void {
    if (!this.deps.isSignedIn() || this.deps.isAway()) {
      return
    }
    let idleMs = 0
    try {
      idleMs = Math.max(0, this.deps.idleSeconds()) * 1000
    } catch {
      return
    }
    if (idleMs >= ORCA_PIT_IDLE_LIMIT_MS) {
      this.goAway(this.now() - idleMs)
    }
  }

  /** Sleep or screen lock: the moment counts as the start of the absence. */
  onPause(): void {
    this.pausedAt ??= this.now()
  }

  /** Back from sleep or unlocked: away if it lasted the limit, even if a key was just pressed. */
  onWake(): void {
    const since = this.pausedAt
    this.pausedAt = null
    if (since === null || !this.deps.isSignedIn() || this.deps.isAway()) {
      return
    }
    if (this.now() - since >= ORCA_PIT_IDLE_LIMIT_MS) {
      this.goAway(since)
    } else {
      this.check()
    }
  }

  onLogin(): void {
    this.pausedAt = null
    this.deps.record('presence_start', this.now())
  }

  onResume(): void {
    this.deps.record('presence_resume', this.now())
  }

  /** Before the session is dropped (sign-out) or the app quits. */
  onLeave(): void {
    if (this.deps.isSignedIn()) {
      this.deps.record('presence_end', this.now())
    }
  }

  private goAway(since: number): void {
    this.deps.markAway(since)
    this.deps.record('presence_idle', since)
    this.deps.notify()
  }
}
