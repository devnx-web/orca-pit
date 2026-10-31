// Orca-Pit: the browser's idle measure, apart from React so it can be tested with plain numbers.

// Why 10 min: the same rule as the desktop app (main/devnx-control/orca-pit-presence-watch).
export const ORCA_PIT_WEB_IDLE_LIMIT_MS = 10 * 60_000

export class OrcaPitWebIdleClock {
  private lastActivity: number
  private away = false

  constructor(now: number = Date.now()) {
    this.lastActivity = now
  }

  /** Any key, click, touch or focus on the page. Ignored while the screen is up. */
  note(now: number): void {
    if (!this.away) {
      this.lastActivity = now
    }
  }

  /** The moment the person stopped, when the limit has passed now; null otherwise or if away. */
  awayIfIdle(now: number): number | null {
    if (this.away || now - this.lastActivity < ORCA_PIT_WEB_IDLE_LIMIT_MS) {
      return null
    }
    this.away = true
    return this.lastActivity
  }

  resume(now: number): void {
    this.away = false
    this.lastActivity = now
  }
}
