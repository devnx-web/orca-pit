// Orca-Pit: the DevNX source's list state — which linked Control project, the filters
// (open statuses by default, "Mine" = assignee=me) and the tasks the panel returned.
import { useEffect, useMemo, useState } from 'react'
import type { Repo } from '../../../../shared/repo-types'
import {
  DEVNX_OPEN_TASK_STATUSES,
  type DevnxControlProjectReference,
  type DevnxControlTask,
  type DevnxTaskStatus
} from '../../../../shared/orca-pit-devnx-tasks'
import { orcaPitDevnxApi } from '@/lib/orca-pit-devnx-status'

export type DevnxStatusFilter = 'open' | 'all' | DevnxTaskStatus

export type DevnxLinkedProject = DevnxControlProjectReference & { repos: Repo[] }

const LIST_LIMIT = 100
const SEARCH_DEBOUNCE_MS = 300

/** One entry per Control project; selected projects first, then the rest of Orca's projects. */
export function getDevnxLinkedProjects(
  selectedRepos: readonly Repo[],
  allRepos: readonly Repo[]
): DevnxLinkedProject[] {
  const byId = new Map<number, DevnxLinkedProject>()
  const source = selectedRepos.some((repo) => repo.devnxControlProject) ? selectedRepos : allRepos
  for (const repo of source) {
    const link = repo.devnxControlProject
    if (!link) {
      continue
    }
    const entry = byId.get(link.id) ?? { id: link.id, name: link.name, repos: [] }
    entry.repos.push(repo)
    byId.set(link.id, entry)
  }
  return [...byId.values()]
}

export function devnxStatusesForFilter(filter: DevnxStatusFilter): readonly string[] {
  return filter === 'open' ? DEVNX_OPEN_TASK_STATUSES : filter === 'all' ? [] : [filter]
}

export function useOrcaPitDevnxTasks(projectId: number | null) {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<DevnxStatusFilter>('open')
  const [mine, setMine] = useState(false)
  const [nonce, setNonce] = useState(0)
  const [tasks, setTasks] = useState<DevnxControlTask[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [search])

  const statuses = useMemo(() => devnxStatusesForFilter(statusFilter), [statusFilter])

  useEffect(() => {
    const api = orcaPitDevnxApi()
    if (!api || projectId === null) {
      setTasks([])
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    void api
      .listTasks({ projectId, search: debouncedSearch, statuses, mine, limit: LIST_LIMIT })
      .then(
        (result) => {
          if (cancelled) {
            return
          }
          setTasks(result.ok ? result.value : [])
          setError(result.ok ? null : result.error)
        },
        (caught: unknown) => {
          if (!cancelled) {
            setTasks([])
            setError(String(caught))
          }
        }
      )
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [debouncedSearch, mine, nonce, projectId, statuses])

  return {
    search,
    setSearch,
    statusFilter,
    setStatusFilter,
    mine,
    setMine,
    tasks,
    loading,
    error,
    refresh: () => setNonce((value) => value + 1)
  }
}

export type OrcaPitDevnxTasksState = ReturnType<typeof useOrcaPitDevnxTasks>
