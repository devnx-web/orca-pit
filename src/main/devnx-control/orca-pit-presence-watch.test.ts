import { describe, expect, it, vi } from 'vitest'
import { ORCA_PIT_IDLE_LIMIT_MS, OrcaPitPresenceWatch } from './orca-pit-presence-watch'

function setup(idleSeconds: number, signedIn = true) {
  let away: number | null = null
  let now = 10_000_000
  const deps = {
    idleSeconds: vi.fn(() => idleSeconds),
    isSignedIn: () => signedIn,
    isAway: () => away !== null,
    markAway: vi.fn((since: number) => {
      away = since
    }),
    record: vi.fn(),
    notify: vi.fn(),
    now: () => now
  }
  const watch = new OrcaPitPresenceWatch(deps)
  return {
    watch,
    deps,
    advance: (ms: number) => {
      now += ms
    },
    now: () => now,
    away: () => away
  }
}

describe('OrcaPitPresenceWatch', () => {
  it('stays quiet under the limit', () => {
    const { watch, deps } = setup(599)
    watch.check()
    expect(deps.markAway).not.toHaveBeenCalled()
    expect(deps.record).not.toHaveBeenCalled()
  })

  it('goes away at 10 minutes, stamping the moment the person stopped', () => {
    const { watch, deps, now } = setup(650)
    watch.check()
    const since = now() - 650_000
    expect(deps.markAway).toHaveBeenCalledWith(since)
    expect(deps.record).toHaveBeenCalledWith('presence_idle', since)
    expect(deps.notify).toHaveBeenCalledOnce()
    // The screen is up: no second idle event.
    watch.check()
    expect(deps.record).toHaveBeenCalledOnce()
  })

  it('does nothing while nobody is signed in', () => {
    const { watch, deps } = setup(10_000, false)
    watch.check()
    watch.onLeave()
    expect(deps.record).not.toHaveBeenCalled()
  })

  it('counts a long sleep or lock from the moment it began', () => {
    const { watch, deps, advance, now } = setup(0)
    watch.onPause()
    const pausedAt = now()
    advance(ORCA_PIT_IDLE_LIMIT_MS + 1)
    watch.onWake()
    expect(deps.record).toHaveBeenCalledWith('presence_idle', pausedAt)
  })

  it('lets a short lock pass', () => {
    const { watch, deps, advance } = setup(0)
    watch.onPause()
    advance(60_000)
    watch.onWake()
    expect(deps.record).not.toHaveBeenCalled()
  })

  it('records start, resume and end', () => {
    const { watch, deps, now } = setup(0)
    watch.onLogin()
    watch.onResume()
    watch.onLeave()
    expect(deps.record.mock.calls).toEqual([
      ['presence_start', now()],
      ['presence_resume', now()],
      ['presence_end', now()]
    ])
  })
})
