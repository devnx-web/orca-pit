// Orca-Pit: the sidebar filters beside "Group by": "Mine", one person, one machine. A person
// owns an agent when they sent its last command or started it. Workspaces with no matching agent
// leave the list (and the keyboard order); in the "Agents" view the agent rows are cut too.
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import { normalizeExecutionHostId } from '../../../../shared/execution-host'
import { orcaPitAuthorKey } from '../../../../shared/orca-pit-agent-authors'
import type { OrcaPitHostPresence, OrcaPitPerson } from '../../../../shared/orca-pit-presence'
import type { Worktree } from '../../../../shared/worktree/types'

export type OrcaPitAgentFilters = {
  mine: boolean
  /** A person key (`u:<id>`, …) or null for everyone. */
  person: string | null
  host: ExecutionHostId | null
}

export const NO_ORCA_PIT_AGENT_FILTERS: OrcaPitAgentFilters = Object.freeze({
  mine: false,
  person: null,
  host: null
})

const STORAGE_KEY = 'orca-pit.agent-filters.v1'

export function parseOrcaPitAgentFilters(value: unknown): OrcaPitAgentFilters {
  if (typeof value !== 'object' || value === null) {
    return NO_ORCA_PIT_AGENT_FILTERS
  }
  const raw = value as Record<string, unknown>
  const mine = raw.mine === true
  return {
    mine,
    // "Mine" and a person are one choice; a stored pair keeps "Mine".
    person: !mine && typeof raw.person === 'string' && raw.person ? raw.person : null,
    host: typeof raw.host === 'string' ? normalizeExecutionHostId(raw.host) : null
  }
}

function loadFilters(): OrcaPitAgentFilters {
  try {
    return parseOrcaPitAgentFilters(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'))
  } catch {
    return NO_ORCA_PIT_AGENT_FILTERS
  }
}

const filtersStore = createStore<{ filters: OrcaPitAgentFilters }>(() => ({
  filters: loadFilters()
}))

filtersStore.subscribe(({ filters }) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filters))
  } catch {
    // The filters still apply for this session when device storage is unavailable.
  }
})

export function setOrcaPitAgentFilters(patch: Partial<OrcaPitAgentFilters>): void {
  const next = { ...filtersStore.getState().filters, ...patch }
  if (patch.mine) {
    next.person = null
  } else if (patch.person) {
    next.mine = false
  }
  filtersStore.setState({ filters: next })
}

export function getOrcaPitAgentFilters(): OrcaPitAgentFilters {
  return filtersStore.getState().filters
}

export function useOrcaPitAgentFilters(): OrcaPitAgentFilters {
  return useStore(filtersStore, (state) => state.filters)
}

export function orcaPitAgentFilterCount(filters: OrcaPitAgentFilters): number {
  return (filters.mine || filters.person ? 1 : 0) + (filters.host ? 1 : 0)
}

/** The person keys an agent must belong to, or null when no person filter is on. */
export function orcaPitPeopleFilterKeys(
  filters: OrcaPitAgentFilters,
  hosts: readonly OrcaPitHostPresence[]
): ReadonlySet<string> | null {
  if (filters.person) {
    return new Set([filters.person])
  }
  if (!filters.mine) {
    return null
  }
  // Why every host's view of "me": a paired desktop is "me" on each server it reaches.
  const keys = new Set<string>()
  for (const host of hosts) {
    if (host.self) {
      keys.add(host.self.key)
    }
  }
  return keys
}

/** Whether the agent in `paneKey` was last driven or started by one of `people`. */
export function orcaPitPaneBelongsTo(
  paneKey: string,
  people: ReadonlySet<string>,
  hosts: readonly OrcaPitHostPresence[]
): boolean {
  for (const host of hosts) {
    const author = Object.hasOwn(host.authors, paneKey) ? host.authors[paneKey] : undefined
    if (author && people.has(orcaPitAuthorKey(author))) {
      return true
    }
    const starter = Object.hasOwn(host.starters, paneKey) ? host.starters[paneKey] : undefined
    if (starter && people.has(starter.key)) {
      return true
    }
  }
  return false
}

/**
 * The workspace test the list and the keyboard order share, or null when no filter is on.
 * `panesByWorkspace` holds the pane keys of each workspace's agent rows.
 */
export function orcaPitWorkspaceFilter(args: {
  filters: OrcaPitAgentFilters
  panesByWorkspace: ReadonlyMap<string, readonly string[]>
  hosts: readonly OrcaPitHostPresence[]
  hostOf: (worktree: Worktree) => ExecutionHostId
}): ((worktree: Worktree) => boolean) | null {
  const { filters, panesByWorkspace, hosts, hostOf } = args
  const people = orcaPitPeopleFilterKeys(filters, hosts)
  if (!people && !filters.host) {
    return null
  }
  return (worktree) => {
    if (filters.host && hostOf(worktree) !== filters.host) {
      return false
    }
    if (!people) {
      return true
    }
    const panes = panesByWorkspace.get(worktree.id) ?? []
    return panes.some((paneKey) => orcaPitPaneBelongsTo(paneKey, people, hosts))
  }
}

/** Everyone the hosts know about, for the person filter: authors, starters, viewers, online. */
export function orcaPitKnownPeople(hosts: readonly OrcaPitHostPresence[]): OrcaPitPerson[] {
  const byKey = new Map<string, OrcaPitPerson>()
  const add = (person: OrcaPitPerson): void => {
    if (person.name.trim() && !byKey.has(person.key)) {
      byKey.set(person.key, person)
    }
  }
  for (const host of hosts) {
    for (const author of Object.values(host.authors)) {
      add({ key: orcaPitAuthorKey(author), name: author.name, userId: author.userId ?? null })
    }
    Object.values(host.starters).forEach(add)
    Object.values(host.viewers).forEach((list) => list.forEach(add))
    host.online.forEach(add)
  }
  return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name))
}
