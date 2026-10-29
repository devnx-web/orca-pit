// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '@/store'
import {
  EMPTY_ORCA_PIT_HOST_PRESENCE,
  type OrcaPitHostPresence
} from '../../../../shared/orca-pit-presence'
import type { Worktree } from '../../../../shared/worktree/types'
import { NO_ORCA_PIT_AGENT_FILTERS, setOrcaPitAgentFilters } from './orca-pit-agent-filters'
import { setAgentsOnlyView } from './orca-pit-agents-view'
import { computeRenderedSidebarWorktreeOrder } from './rendered-sidebar-worktree-order'
import type * as AgentsView from './orca-pit-agents-view'
import type * as SidebarPresence from './orca-pit-sidebar-presence'
import { repo, worktree } from './worktree-list-groups-test-fixtures'

const panes = new Map<string, readonly string[]>([
  ['w-fabio', ['tab-f:pane']],
  ['w-ana', ['tab-a:pane']]
])
const hosts: OrcaPitHostPresence[] = [
  {
    ...EMPTY_ORCA_PIT_HOST_PRESENCE,
    self: { key: 'u:1', name: 'Fabio', userId: 1 },
    authors: {
      'tab-f:pane': { name: 'Fabio', at: 1, userId: 1 },
      'tab-a:pane': { name: 'Ana', at: 2, userId: 2 }
    }
  }
]

// Why mocks: agent rows come from the live status pipeline and people from the hosts' polls.
vi.mock('./orca-pit-agents-view', async (importOriginal) => ({
  ...(await importOriginal<typeof AgentsView>()),
  getWorkspaceAgentPanes: () => panes
}))
vi.mock('./orca-pit-sidebar-presence', async (importOriginal) => ({
  ...(await importOriginal<typeof SidebarPresence>()),
  getOrcaPitHostPresences: () => hosts
}))

const initialState = useAppStore.getInitialState()
const workspaces: Worktree[] = ['w-fabio', 'w-ana', 'w-idle'].map((id, sortOrder) => ({
  ...worktree,
  id,
  path: `/tmp/${id}`,
  displayName: id,
  sortOrder
}))

function order(): string[] {
  useAppStore.setState(
    {
      ...initialState,
      repos: [repo],
      worktreesByRepo: { [repo.id]: workspaces },
      showSleepingWorkspaces: true,
      filterRepoIds: [],
      groupBy: 'repo'
    },
    true
  )
  return computeRenderedSidebarWorktreeOrder(useAppStore.getState(), workspaces)
}

describe('Orca-Pit filters in the keyboard order', () => {
  afterEach(() => {
    setOrcaPitAgentFilters(NO_ORCA_PIT_AGENT_FILTERS)
    setAgentsOnlyView(false)
    useAppStore.setState(initialState, true)
  })

  it('walks every workspace without a filter', () => {
    expect(order()).toEqual(['w-fabio', 'w-ana', 'w-idle'])
  })

  it('skips what "Mine" or a person hides, as the list does', () => {
    setOrcaPitAgentFilters({ mine: true })
    expect(order()).toEqual(['w-fabio'])
    setOrcaPitAgentFilters({ person: 'u:2' })
    expect(order()).toEqual(['w-ana'])
  })

  it('skips workspaces of other machines', () => {
    setOrcaPitAgentFilters({ host: 'runtime:nitro5' })
    expect(order()).toEqual([])
    setOrcaPitAgentFilters({ host: 'local' })
    expect(order()).toEqual(['w-fabio', 'w-ana', 'w-idle'])
  })

  it('combines with the "Agents" view, which drops workspaces without agents', () => {
    setAgentsOnlyView(true)
    expect(order()).toEqual(['w-fabio', 'w-ana'])
    setOrcaPitAgentFilters({ person: 'u:2' })
    expect(order()).toEqual(['w-ana'])
  })
})
