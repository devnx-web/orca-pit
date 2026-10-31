// Orca-Pit: the browser's "time clock". A browser signed in with the DevNX Control measures its
// own idle time (keys, mouse, touch, focus on the page); after 10 minutes the page is covered by
// "Are you still there?" and the central Orca's diary learns when the person stopped. A device
// paired by link has no person to clock and never sees the screen.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { OrcaPitAwayScreen } from '@/components/orca-pit-login/OrcaPitAwayScreen'
import { setOrcaPitWebAway } from '@/components/orca-pit-login/orca-pit-app-session-store'
import type {
  OrcaPitPresenceEvent,
  OrcaPitPresenceResult
} from '../../../shared/rpc-contract/orca-pit-presence-params'
import { clearStoredWebRuntimeEnvironment } from './web-runtime-environment'
import { OrcaPitWebIdleClock } from './orca-pit-web-idle'

type Person = NonNullable<OrcaPitPresenceResult['person']>

// The web client's "local" runtime is the paired server.
async function tell(event: OrcaPitPresenceEvent, since?: number): Promise<Person | null> {
  try {
    const result = await callRuntimeRpc<OrcaPitPresenceResult>(
      { kind: 'local' },
      'orcaPit.presence',
      since === undefined ? { event } : { event, since },
      { timeoutMs: 15_000 }
    )
    return result?.person ?? null
  } catch {
    // An older server without the method, or a dropped socket: no clock, nothing blocked.
    return null
  }
}

const ACTIVITY_EVENTS = ['keydown', 'pointerdown', 'pointermove', 'wheel', 'touchstart', 'focus']
// Why 15 s: the screen may come up a few seconds late; the moment recorded is still exact.
const CHECK_EVERY_MS = 15_000

export function OrcaPitWebPresenceGate({ children }: { children: ReactNode }): React.JSX.Element {
  const [person, setPerson] = useState<Person | null>(null)
  const [awaySince, setAwaySince] = useState<number | null>(null)
  const clock = useRef(new OrcaPitWebIdleClock())

  useEffect(() => {
    let cancelled = false
    void tell('start').then((answer) => {
      if (!cancelled) {
        setPerson(answer)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!person) {
      return
    }
    const idle = clock.current
    const note = (): void => idle.note(Date.now())
    const check = (): void => {
      const since = idle.awayIfIdle(Date.now())
      if (since !== null) {
        setOrcaPitWebAway(true)
        setAwaySince(since)
        void tell('idle', since)
      }
    }
    for (const name of ACTIVITY_EVENTS) {
      window.addEventListener(name, note, { capture: true, passive: true })
    }
    // A tab that slept in the background is checked the moment it comes back.
    document.addEventListener('visibilitychange', check)
    const timer = setInterval(check, CHECK_EVERY_MS)
    return () => {
      for (const name of ACTIVITY_EVENTS) {
        window.removeEventListener(name, note, { capture: true })
      }
      document.removeEventListener('visibilitychange', check)
      clearInterval(timer)
    }
  }, [person])

  const away = person !== null && awaySince !== null
  return (
    <>
      <div className="contents" inert={away}>
        {children}
      </div>
      {away ? (
        <OrcaPitAwayScreen
          name={person.name}
          avatarUrl={person.avatarUrl}
          personKey={`u:${person.id}`}
          since={awaySince}
          onContinue={async () => {
            clock.current.resume(Date.now())
            setOrcaPitWebAway(false)
            setAwaySince(null)
            await tell('resume')
          }}
          onSignOut={async () => {
            await tell('end')
            // Back to the e-mail and password: the next person signs in with their own name.
            clearStoredWebRuntimeEnvironment()
            window.location.reload()
          }}
        />
      ) : null}
    </>
  )
}
