// Orca-Pit: "who" on the sidebar's agent rows. The central Orca remembers, per pane, the person
// who sent the last command; every client polls it through `orcaPit.agentAuthors`, together with
// who is looking at each pane and who is connected (see orca-pit-presence).

export type OrcaPitPaneAuthor = { name: string; at: number; userId?: number | null }

/** paneKey → last author. */
export type OrcaPitAgentAuthors = Record<string, OrcaPitPaneAuthor>

const MAX_LABEL_CHARS = 16

export function orcaPitFirstName(name: string | null | undefined): string | null {
  const first = name?.trim().split(/\s+/)[0]
  if (!first) {
    return null
  }
  return first.length > MAX_LABEL_CHARS ? `${first.slice(0, MAX_LABEL_CHARS - 1)}…` : first
}

/** The first name a row shows, or null when nobody is known for that pane. */
export function orcaPitAgentAuthorLabel(
  authors: OrcaPitAgentAuthors | null | undefined,
  paneKey: string | null | undefined
): string | null {
  if (!authors || !paneKey || !Object.hasOwn(authors, paneKey)) {
    return null
  }
  return orcaPitFirstName(authors[paneKey]?.name)
}

/** Two letters for an avatar: first and last name, or the start of a single name. */
export function orcaPitInitials(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) {
    return '?'
  }
  const first = Array.from(words[0])[0] ?? ''
  const last = words.length > 1 ? (Array.from(words.at(-1) ?? '')[0] ?? '') : ''
  return `${first}${last}`.toUpperCase()
}

/** "3m", "2h", "4d", or `nowWord` under a minute; future stamps (clock skew) read as now. */
export function orcaPitAge(at: number, now: number, nowWord: string): string {
  const minutes = Math.floor((now - at) / 60_000)
  if (minutes < 1) {
    return nowWord
  }
  if (minutes < 60) {
    return `${minutes}m`
  }
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`
}

/** "Fabio · 3m": first name and how long ago the last command was sent. */
export function orcaPitAuthorLine(
  author: OrcaPitPaneAuthor,
  now: number,
  nowWord: string
): string | null {
  const name = orcaPitFirstName(author.name)
  return name ? `${name} · ${orcaPitAge(author.at, now, nowWord)}` : null
}

/** A stable person key: the Control user when known, else the name. */
export function orcaPitAuthorKey(author: OrcaPitPaneAuthor): string {
  return typeof author.userId === 'number' ? `u:${author.userId}` : `n:${author.name.trim()}`
}

export function parseOrcaPitAgentAuthors(value: unknown): OrcaPitAgentAuthors {
  const authors: OrcaPitAgentAuthors = {}
  if (typeof value !== 'object' || value === null || !('authors' in value)) {
    return authors
  }
  const raw = value.authors
  if (typeof raw !== 'object' || raw === null) {
    return authors
  }
  for (const [paneKey, entry] of Object.entries(raw)) {
    if (
      typeof entry === 'object' &&
      entry !== null &&
      'name' in entry &&
      typeof entry.name === 'string' &&
      'at' in entry &&
      typeof entry.at === 'number'
    ) {
      const userId =
        'userId' in entry && typeof entry.userId === 'number' && Number.isSafeInteger(entry.userId)
          ? entry.userId
          : null
      authors[paneKey] = { name: entry.name, at: entry.at, userId }
    }
  }
  return authors
}
