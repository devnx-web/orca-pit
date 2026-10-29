// Orca-Pit: the runtime RPC surface for DevNX Control projects and tasks. Every client (this
// window, a paired desktop, the browser) asks the host that owns the Orca project; the host
// reads the Control with the caller's own login when it has one.
import type {
  DevnxControlProjectList,
  DevnxControlTask,
  DevnxControlTaskDetail
} from './orca-pit-devnx-tasks'

export const ORCA_PIT_DEVNX_METHODS = {
  status: 'orcaPit.devnxStatus',
  projects: 'orcaPit.devnxProjects',
  tasks: 'orcaPit.devnxTasks',
  task: 'orcaPit.devnxTask'
} as const

/**
 * - `not_connected`: the host has no Control session (or is an Orca without this feature).
 * - `relogin`: the caller's own Control login is gone or expired; it must sign in again.
 * - `forbidden`: the Control refused this person's role (only admin and programmer read tasks).
 * - `unavailable`: anything else — outage, timeout, malformed answer.
 */
export type OrcaPitDevnxErrorCode = 'not_connected' | 'relogin' | 'forbidden' | 'unavailable'

export type OrcaPitDevnxResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: OrcaPitDevnxErrorCode; error: string }

/** Whose Control login answers: the person's own, or the central machine's session. */
export type OrcaPitDevnxViewer = 'user' | 'central'

export type OrcaPitDevnxStatus = {
  connected: boolean
  viewer: OrcaPitDevnxViewer | null
  /** The caller has a person but no usable Control login; reads answer `relogin`. */
  needsLogin: boolean
  /** Admins (and local callers) may change a project's link; members see it read-only. */
  canLink: boolean
}

export type OrcaPitDevnxProjectsResult = OrcaPitDevnxResult<DevnxControlProjectList>
export type OrcaPitDevnxTasksResult = OrcaPitDevnxResult<DevnxControlTask[]>
export type OrcaPitDevnxTaskResult = OrcaPitDevnxResult<DevnxControlTaskDetail>

export const ORCA_PIT_DEVNX_DISCONNECTED: OrcaPitDevnxStatus = {
  connected: false,
  viewer: null,
  needsLogin: false,
  canLink: false
}

const ERROR_CODES: ReadonlySet<string> = new Set([
  'not_connected',
  'relogin',
  'forbidden',
  'unavailable'
])

/** Shape check of a host's answer; an unknown shape is an `unavailable` failure. */
export function parseOrcaPitDevnxResult<T>(value: unknown): OrcaPitDevnxResult<T> {
  if (typeof value === 'object' && value !== null && 'ok' in value) {
    const raw = value as Record<string, unknown>
    if (raw.ok === true && 'value' in raw) {
      return { ok: true, value: raw.value as T }
    }
    if (raw.ok === false) {
      const code = typeof raw.code === 'string' && ERROR_CODES.has(raw.code) ? raw.code : null
      return {
        ok: false,
        code: (code ?? 'unavailable') as OrcaPitDevnxErrorCode,
        error: typeof raw.error === 'string' ? raw.error : ''
      }
    }
  }
  return { ok: false, code: 'unavailable', error: '' }
}

export function parseOrcaPitDevnxStatus(value: unknown): OrcaPitDevnxStatus {
  if (typeof value !== 'object' || value === null) {
    return ORCA_PIT_DEVNX_DISCONNECTED
  }
  const raw = value as Record<string, unknown>
  const connected = raw.connected === true
  return {
    connected,
    viewer: connected && (raw.viewer === 'user' || raw.viewer === 'central') ? raw.viewer : null,
    needsLogin: connected && raw.needsLogin === true,
    canLink: connected && raw.canLink === true
  }
}
