import { describe, expect, it } from 'vitest'
import { ORCA_PIT_WEB_IDLE_LIMIT_MS, OrcaPitWebIdleClock } from './orca-pit-web-idle'

describe('OrcaPitWebIdleClock', () => {
  it('reports the last activity once the limit passes, and only once', () => {
    const clock = new OrcaPitWebIdleClock(0)
    clock.note(1_000)
    expect(clock.awayIfIdle(1_000 + ORCA_PIT_WEB_IDLE_LIMIT_MS - 1)).toBeNull()
    expect(clock.awayIfIdle(1_000 + ORCA_PIT_WEB_IDLE_LIMIT_MS)).toBe(1_000)
    expect(clock.awayIfIdle(1_000 + 2 * ORCA_PIT_WEB_IDLE_LIMIT_MS)).toBeNull()
  })

  it('ignores activity behind the screen and starts over on resume', () => {
    const clock = new OrcaPitWebIdleClock(0)
    expect(clock.awayIfIdle(ORCA_PIT_WEB_IDLE_LIMIT_MS)).toBe(0)
    clock.note(ORCA_PIT_WEB_IDLE_LIMIT_MS + 5)
    clock.resume(ORCA_PIT_WEB_IDLE_LIMIT_MS + 10)
    expect(clock.awayIfIdle(2 * ORCA_PIT_WEB_IDLE_LIMIT_MS)).toBeNull()
    expect(clock.awayIfIdle(2 * ORCA_PIT_WEB_IDLE_LIMIT_MS + 10)).toBe(
      ORCA_PIT_WEB_IDLE_LIMIT_MS + 10
    )
  })
})
