import { describe, expect, it } from 'vitest'
import {
  EMPTY_ORCA_PIT_HOST_PRESENCE,
  type OrcaPitHostPresence
} from '../../../../shared/orca-pit-presence'
import type { Worktree } from '../../../../shared/worktree/types'
import {
  NO_ORCA_PIT_AGENT_FILTERS,
  orcaPitAgentFilterCount,
  orcaPitKnownPeople,
  orcaPitWorkspaceFilter,
  parseOrcaPitAgentFilters,
  type OrcaPitAgentFilters
} from './orca-pit-agent-filters'
import { scopeOrcaPitRowInputs } from './orca-pit-row-scope'
import { repo, worktree } from './worktree-list-groups-test-fixtures'

const fabio = { key: 'u:1', name: 'Fabio', userId: 1 }
const ana = { key: 'u:2', name: 'Ana', userId: 2 }

function host(overrides: Partial<OrcaPitHostPresence>): OrcaPitHostPresence {
  return { ...EMPTY_ORCA_PIT_HOST_PRESENCE, ...overrides }
}

// Fabio drove w-fabio last; Ana started w-ana's agent, which Fabio never touched.
const central = host({
  self: fabio,
  authors: { 'tab-f:pane': { name: 'Fabio', at: 1, userId: 1 } },
  starters: { 'tab-a:pane': ana }
})
const nitro = host({ self: fabio, authors: { 'tab-n:pane': { name: 'Ana', at: 2, userId: 2 } } })
const hosts = [central, nitro]
const panes = new Map<string, readonly string[]>([
  ['w-fabio', ['tab-f:pane']],
  ['w-ana', ['tab-a:pane']],
  ['w-nitro', ['tab-n:pane']]
])
const workspaces: Worktree[] = ['w-fabio', 'w-ana', 'w-nitro', 'w-idle'].map((id) => ({
  ...worktree,
  id,
  ...(id === 'w-nitro' ? { hostId: 'runtime:nitro5' as const } : {})
}))

function kept(filters: OrcaPitAgentFilters): string[] {
  const keep = orcaPitWorkspaceFilter({
    filters,
    panesByWorkspace: panes,
    hosts,
    hostOf: (entry) => entry.hostId ?? 'local'
  })
  return keep ? workspaces.filter(keep).map((entry) => entry.id) : ['(no filter)']
}

describe('Orca-Pit agent filters', () => {
  it('keeps everything when nothing is picked', () => {
    expect(kept(NO_ORCA_PIT_AGENT_FILTERS)).toEqual(['(no filter)'])
    expect(orcaPitAgentFilterCount(NO_ORCA_PIT_AGENT_FILTERS)).toBe(0)
  })

  it('"Mine" keeps agents I drove last or started, on every host', () => {
    expect(kept({ mine: true, person: null, host: null })).toEqual(['w-fabio'])
  })

  it('a person keeps the agents they drove or started', () => {
    expect(kept({ mine: false, person: 'u:2', host: null })).toEqual(['w-ana', 'w-nitro'])
  })

  it('a machine keeps its workspaces, with or without agents, and combines with a person', () => {
    expect(kept({ mine: false, person: null, host: 'local' })).toEqual([
      'w-fabio',
      'w-ana',
      'w-idle'
    ])
    expect(kept({ mine: false, person: 'u:2', host: 'runtime:nitro5' })).toEqual(['w-nitro'])
    expect(orcaPitAgentFilterCount({ mine: true, person: null, host: 'local' })).toBe(2)
  })

  it('reads stored filters strictly, "Mine" winning over a stored person', () => {
    expect(parseOrcaPitAgentFilters({ mine: true, person: 'u:2', host: 'runtime:x' })).toEqual({
      mine: true,
      person: null,
      host: 'runtime:x'
    })
    expect(parseOrcaPitAgentFilters({ host: 'bogus' }).host).toBeNull()
    expect(parseOrcaPitAgentFilters('nope')).toEqual(NO_ORCA_PIT_AGENT_FILTERS)
  })

  it('lists the people the hosts know, once each', () => {
    expect(orcaPitKnownPeople(hosts).map((person) => person.key)).toEqual(['u:2', 'u:1'])
  })
})

describe('Orca-Pit row scope', () => {
  const inputs = {
    worktrees: workspaces,
    folderWorkspaces: [],
    projectGroups: [],
    placeholderRepoIds: new Set<string>(),
    importedWorktreesByRepo: new Map(),
    newExternalWorktreesInboxByRepo: new Map()
  }
  const base = {
    inputs,
    panesByWorkspace: panes,
    hosts,
    repoOf: () => repo,
    defaultHostId: 'local' as const
  }

  it('filters before the "Agents" view drops workspaces without agents', () => {
    const scoped = scopeOrcaPitRowInputs({
      ...base,
      agentsOnly: true,
      filters: { mine: false, person: null, host: 'local' },
      everyRepoId: [repo.id]
    })
    expect(scoped.worktrees.map((entry) => entry.id)).toEqual(['w-fabio', 'w-ana'])
    expect([...scoped.placeholderRepoIds]).toEqual([repo.id])
  })

  it('leaves the Project view alone without a filter', () => {
    const scoped = scopeOrcaPitRowInputs({
      ...base,
      agentsOnly: false,
      filters: NO_ORCA_PIT_AGENT_FILTERS
    })
    expect(scoped).toBe(inputs)
  })
})
