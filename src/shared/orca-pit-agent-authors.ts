// Orca-Pit: "who" on the sidebar's agent rows. The central Orca remembers, per pane, the first
// name of whoever sent the last command; every client polls it through `orcaPit.agentAuthors`.

export type OrcaPitPaneAuthor = { name: string; at: number }

/** paneKey → last author. */
export type OrcaPitAgentAuthors = Record<string, OrcaPitPaneAuthor>

export type OrcaPitAgentAuthorsResult = { authors: OrcaPitAgentAuthors }

const MAX_LABEL_CHARS = 16

/** The label a row shows, or null when nobody is known for that pane. */
export function orcaPitAgentAuthorLabel(
  authors: OrcaPitAgentAuthors | null | undefined,
  paneKey: string | null | undefined
): string | null {
  if (!authors || !paneKey || !Object.hasOwn(authors, paneKey)) {
    return null
  }
  const name = authors[paneKey]?.name?.trim().split(/\s+/)[0]
  if (!name) {
    return null
  }
  return name.length > MAX_LABEL_CHARS ? `${name.slice(0, MAX_LABEL_CHARS - 1)}…` : name
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
      authors[paneKey] = { name: entry.name, at: entry.at }
    }
  }
  return authors
}
