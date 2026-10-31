// Orca-Pit: the activity diary. Each person's action on the central Orca becomes one event,
// kept on this computer and sent to the DevNX Control (POST /api/orca/activity/ingest).
import { randomBytes } from 'node:crypto'

export const ORCA_PIT_ACTIVITY_ACTIONS = [
  'agent_message',
  'terminal_line',
  'workspace_created',
  'agent_started',
  'agent_stopped',
  'settings_changed',
  'login',
  // Presence: signed in, stopped touching the computer (at the moment they stopped), back, left.
  'presence_start',
  'presence_idle',
  'presence_resume',
  'presence_end'
] as const

export type OrcaPitPresenceAction = Extract<
  OrcaPitActivityAction,
  'presence_start' | 'presence_idle' | 'presence_resume' | 'presence_end'
>

export type OrcaPitActivityAction = (typeof ORCA_PIT_ACTIVITY_ACTIONS)[number]

/** One event exactly as the ingest route reads it. */
export type OrcaPitActivityEvent = {
  id: string
  user_id: number | null
  device_label: string | null
  action: OrcaPitActivityAction
  project_id: number | null
  task_id: number | null
  orca_project: string | null
  workspace: string | null
  session_id: string | null
  agent: string | null
  tokens_in: number | null
  tokens_out: number | null
  detail: string | null
  at: string
}

/** What a recorder hands the diary; the id and the -03:00 timestamp are stamped on insert. */
export type OrcaPitActivityDraft = Omit<OrcaPitActivityEvent, 'id' | 'at'> & {
  atMs: number
  /** The central machine's own owner, whose Control user id may be learned only later. */
  localActor: boolean
}

// Why 500: the contract's cap for `detail`; longer text is cut, never sent whole.
export const ORCA_PIT_DETAIL_MAX_CHARS = 500
export const ORCA_PIT_HIDDEN_DETAIL = '[oculto]'

export function clipDetail(text: string | null | undefined): string | null {
  const trimmed = (text ?? '').trim()
  if (!trimmed) {
    return null
  }
  return trimmed.length > ORCA_PIT_DETAIL_MAX_CHARS
    ? `${trimmed.slice(0, ORCA_PIT_DETAIL_MAX_CHARS - 1)}…`
    : trimmed
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** ULID layout: 10 chars of milliseconds, then 16 random chars; sorts by time as text. */
export function makeActivityId(atMs: number = Date.now()): string {
  let time = ''
  let remaining = Math.max(0, Math.floor(atMs))
  for (let index = 0; index < 10; index += 1) {
    time = CROCKFORD[remaining % 32] + time
    remaining = Math.floor(remaining / 32)
  }
  const bytes = randomBytes(16)
  let random = ''
  for (const byte of bytes) {
    random += CROCKFORD[byte % 32]
  }
  return time + random
}

// Why a fixed offset: the Control stores -03:00 dates and Brazil has had no daylight time since 2019.
const BRASILIA_OFFSET_MS = 3 * 60 * 60 * 1000

export function brasiliaIso(atMs: number): string {
  return `${new Date(atMs - BRASILIA_OFFSET_MS).toISOString().slice(0, 19)}-03:00`
}
