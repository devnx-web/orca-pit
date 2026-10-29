// Orca-Pit: who is around a central Orca, beside "who sent the last command". The central answers
// `orcaPit.agentAuthors` with the people looking at each pane, who started each agent and who is
// connected right now; every client draws the sidebar from that one reply.
import { parseOrcaPitAgentAuthors, type OrcaPitAgentAuthors } from './orca-pit-agent-authors'

/** `key` is `u:<Control user id>`, or `d:<device hash>` / `central` for someone without a login. */
export type OrcaPitPerson = { key: string; name: string; userId: number | null }

export type OrcaPitOnlineEntry = OrcaPitPerson & {
  /** The device's name ("Ana · navegador", "Nitro5"); empty for the central's own window. */
  device: string
  since: number
  central: boolean
}

export type OrcaPitAgentAuthorsResult = {
  authors: OrcaPitAgentAuthors
  /** paneKey → who started the agent running there. */
  starters?: Record<string, OrcaPitPerson>
  /** paneKey → who has it on screen right now. */
  viewers?: Record<string, OrcaPitPerson[]>
  online?: OrcaPitOnlineEntry[]
  /** Whoever asked, as the central sees them. */
  self?: OrcaPitPerson | null
  /** The central's machine name, so a client can name it instead of "Local". */
  machineName?: string
  /** The central's clock, so ages survive a skewed client clock. */
  now?: number
}

export type OrcaPitHostPresence = Required<Omit<OrcaPitAgentAuthorsResult, 'now' | 'self'>> & {
  self: OrcaPitPerson | null
}

export const EMPTY_ORCA_PIT_HOST_PRESENCE: OrcaPitHostPresence = Object.freeze({
  authors: {},
  starters: {},
  viewers: {},
  online: [],
  self: null,
  machineName: ''
})

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseOrcaPitPerson(value: unknown): OrcaPitPerson | null {
  if (!isRecord(value) || typeof value.key !== 'string' || typeof value.name !== 'string') {
    return null
  }
  const userId =
    typeof value.userId === 'number' && Number.isSafeInteger(value.userId) ? value.userId : null
  return value.key ? { key: value.key, name: value.name.slice(0, 120), userId } : null
}

function parsePeopleByPane(value: unknown): Record<string, OrcaPitPerson[]> {
  const out: Record<string, OrcaPitPerson[]> = {}
  if (!isRecord(value)) {
    return out
  }
  for (const [paneKey, list] of Object.entries(value)) {
    const people = Array.isArray(list)
      ? list.map(parseOrcaPitPerson).filter((p): p is OrcaPitPerson => p !== null)
      : []
    if (people.length > 0) {
      out[paneKey] = people
    }
  }
  return out
}

function parseStarters(value: unknown): Record<string, OrcaPitPerson> {
  const out: Record<string, OrcaPitPerson> = {}
  if (isRecord(value)) {
    for (const [paneKey, entry] of Object.entries(value)) {
      const person = parseOrcaPitPerson(entry)
      if (person) {
        out[paneKey] = person
      }
    }
  }
  return out
}

function parseOnline(value: unknown): OrcaPitOnlineEntry[] {
  if (!Array.isArray(value)) {
    return []
  }
  const out: OrcaPitOnlineEntry[] = []
  for (const entry of value) {
    const person = parseOrcaPitPerson(entry)
    if (person && isRecord(entry) && typeof entry.since === 'number') {
      out.push({
        ...person,
        device: typeof entry.device === 'string' ? entry.device.slice(0, 120) : '',
        since: entry.since,
        central: entry.central === true
      })
    }
  }
  return out
}

/**
 * Lenient parse of one host's reply. An older central sends only `authors`; the rest stays empty.
 * `receivedAt` moves the central's stamps onto this client's clock.
 */
export function parseOrcaPitHostPresence(value: unknown, receivedAt: number): OrcaPitHostPresence {
  if (!isRecord(value)) {
    return EMPTY_ORCA_PIT_HOST_PRESENCE
  }
  const skew = typeof value.now === 'number' ? receivedAt - value.now : 0
  const authors = parseOrcaPitAgentAuthors(value)
  for (const author of Object.values(authors)) {
    author.at += skew
  }
  const online = parseOnline(value.online).map((entry) => ({ ...entry, since: entry.since + skew }))
  return {
    authors,
    starters: parseStarters(value.starters),
    viewers: parsePeopleByPane(value.viewers),
    online,
    self: parseOrcaPitPerson(value.self),
    machineName: typeof value.machineName === 'string' ? value.machineName.slice(0, 120) : ''
  }
}

/** Viewers of a pane minus the people in `exclude` (the one looking at this sidebar). */
export function otherViewers(
  viewers: readonly OrcaPitPerson[] | undefined,
  exclude: ReadonlySet<string>
): OrcaPitPerson[] {
  return (viewers ?? []).filter((viewer) => !exclude.has(viewer.key))
}

export type OrcaPitOnlinePerson = OrcaPitPerson & {
  devices: { device: string; since: number; central: boolean }[]
  since: number
}

/**
 * One entry per person across every host this client polls, earliest connection first. Empty when
 * nobody but one person is around: a strip with only yourself (or only the owner) says nothing.
 */
export function deriveOrcaPitOnlineNow(
  hosts: readonly Pick<OrcaPitHostPresence, 'online'>[]
): OrcaPitOnlinePerson[] {
  const byKey = new Map<string, OrcaPitOnlinePerson>()
  for (const host of hosts) {
    for (const entry of host.online) {
      const device = { device: entry.device, since: entry.since, central: entry.central }
      const known = byKey.get(entry.key)
      if (!known) {
        byKey.set(entry.key, {
          key: entry.key,
          name: entry.name,
          userId: entry.userId,
          devices: [device],
          since: entry.since
        })
        continue
      }
      if (!known.devices.some((d) => d.device === device.device && d.central === device.central)) {
        known.devices.push(device)
      }
      known.since = Math.min(known.since, entry.since)
    }
  }
  const people = [...byKey.values()].sort(
    (a, b) => a.since - b.since || a.name.localeCompare(b.name)
  )
  for (const person of people) {
    person.devices.sort((a, b) => a.since - b.since)
  }
  return people.length > 1 ? people : []
}
