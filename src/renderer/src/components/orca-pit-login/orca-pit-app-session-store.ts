// Orca-Pit: the renderer's copy of who is signed in to this app (main keeps the session). The
// sign-in screen, the person bar and "Add server" all read it; null while the first answer is out.
import { useSyncExternalStore } from 'react'
import { isWebClientLocation } from '@/lib/web-client-location'
import type { OrcaPitAppApi, OrcaPitAppSessionState } from '../../../../shared/orca-pit-app-session'

const NOT_REQUIRED: OrcaPitAppSessionState = { kind: 'not-required' }
const LOAD_TIMEOUT_MS = 8000

let current: OrcaPitAppSessionState | null = null
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()

/** The desktop bridge; absent in the web client and in tests, where nobody signs in here. */
export function orcaPitAppApi(): OrcaPitAppApi | null {
  // Why the location: the web client answers every window.api member with a stand-in.
  if (isWebClientLocation()) {
    return null
  }
  const api = (window as { api?: { orcaPit?: OrcaPitAppApi } }).api?.orcaPit
  return api && typeof api.getSession === 'function' ? api : null
}

export function setOrcaPitAppSession(next: OrcaPitAppSessionState): void {
  current = next
  for (const listener of listeners) {
    listener()
  }
}

export function loadOrcaPitAppSession(): Promise<void> {
  loading ??= (async () => {
    const api = orcaPitAppApi()
    let state: OrcaPitAppSessionState = NOT_REQUIRED
    try {
      const answer = api
        ? await Promise.race([
            api.getSession(),
            // Why: a main process that never answers must not leave the window covered forever.
            new Promise<OrcaPitAppSessionState>((resolve) =>
              setTimeout(() => resolve(NOT_REQUIRED), LOAD_TIMEOUT_MS)
            )
          ])
        : NOT_REQUIRED
      state = answer && typeof answer === 'object' && 'kind' in answer ? answer : NOT_REQUIRED
    } catch {
      // Why open: a broken bridge must not lock the person out of their own machine.
      state = NOT_REQUIRED
    }
    setOrcaPitAppSession(state)
  })().finally(() => {
    loading = null
  })
  return loading
}

export async function signOutOrcaPitApp(): Promise<void> {
  const api = orcaPitAppApi()
  if (api) {
    setOrcaPitAppSession(await api.logout())
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

const read = (): OrcaPitAppSessionState | null => current

/** While nobody is signed in (or before the first answer) the app stays behind the login. */
export function isOrcaPitAppLocked(): boolean {
  return current === null || current.kind === 'signed-out'
}

/** Marks the login screen, the only place keys may reach while the app is locked. */
export const ORCA_PIT_LOGIN_ATTRIBUTE = 'data-orca-pit-login'

/**
 * Keys aimed anywhere but the login screen stop here while locked, ahead of every app shortcut:
 * install before the app keyboard router so this capture listener runs first.
 */
export function installOrcaPitLoginKeyGuard(target: Window = window): () => void {
  const guard = (event: KeyboardEvent): void => {
    if (!isOrcaPitAppLocked()) {
      return
    }
    const node = event.target instanceof Element ? event.target : null
    if (!node?.closest(`[${ORCA_PIT_LOGIN_ATTRIBUTE}]`)) {
      event.stopImmediatePropagation()
      event.preventDefault()
      return
    }
    // Inside the form: the field gets the key, the app's shortcuts do not.
    event.stopImmediatePropagation()
  }
  target.addEventListener('keydown', guard, { capture: true })
  target.addEventListener('keyup', guard, { capture: true })
  return () => {
    target.removeEventListener('keydown', guard, { capture: true })
    target.removeEventListener('keyup', guard, { capture: true })
  }
}

export function useOrcaPitAppSession(): OrcaPitAppSessionState | null {
  return useSyncExternalStore(subscribe, read, read)
}

/** Test seam. */
export function resetOrcaPitAppSessionForTests(): void {
  current = null
  loading = null
  listeners.clear()
}
