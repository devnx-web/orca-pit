// Orca-Pit: DevNX Control tasks in the Cmd+J task search — one request per Control project
// linked to the searched Orca projects, open statuses only, like the other providers.
import type { Repo } from '../../../../shared/repo-types'
import {
  DEVNX_OPEN_TASK_STATUSES,
  type DevnxControlTask
} from '../../../../shared/orca-pit-devnx-tasks'
import { normalizeTaskSourceContext } from '../../../../shared/task-source-context'
import { useAppStore } from '@/store'
import { isOrcaPitDevnxConnected, orcaPitDevnxApi } from '@/lib/orca-pit-devnx-status'
import { startWorkspaceFromDevnxTask } from '@/lib/orca-pit-devnx-task-actions'
import { getTaskPageRepoSourceContext } from '../task-page/task-page-source-context'
import type { CmdJTaskSearchResult } from './task-search-results'

export type CmdJDevnxTask = { provider: 'devnx'; issue: DevnxControlTask & { url: string } }

type DevnxRequest = {
  id: string
  provider: 'devnx'
  hostLabel: string
  run: () => Promise<CmdJTaskSearchResult[]>
}

export function createDevnxCmdJTaskSearchRequests(args: {
  query: string
  repos: readonly Repo[]
  limit: number
  signal: AbortSignal
  makeResult: (
    task: CmdJDevnxTask,
    source: NonNullable<ReturnType<typeof normalizeTaskSourceContext>>,
    initialRepoId: string | null,
    hostLabel: string
  ) => CmdJTaskSearchResult
}): DevnxRequest[] {
  const api = orcaPitDevnxApi()
  if (!api || !isOrcaPitDevnxConnected()) {
    return []
  }
  const seen = new Set<number>()
  const requests: DevnxRequest[] = []
  for (const repo of args.repos) {
    const project = repo.devnxControlProject
    if (!project || seen.has(project.id)) {
      continue
    }
    seen.add(project.id)
    const source = normalizeTaskSourceContext({
      provider: 'devnx',
      projectId: getTaskPageRepoSourceContext(repo, 'github')?.projectId ?? repo.id,
      hostId: 'local',
      repoId: repo.id,
      providerIdentity: { provider: 'devnx', controlProjectId: String(project.id) },
      accountLabel: project.name
    })
    if (!source) {
      continue
    }
    requests.push({
      id: `devnx:${project.id}`,
      provider: 'devnx',
      hostLabel: project.name,
      run: async () => {
        if (args.signal.aborted) {
          return []
        }
        const result = await api.listTasks({
          projectId: project.id,
          search: args.query,
          statuses: DEVNX_OPEN_TASK_STATUSES,
          limit: args.limit
        })
        if (!result.ok) {
          throw new Error(result.error)
        }
        return result.value.flatMap((task) =>
          task.url
            ? [
                args.makeResult(
                  { provider: 'devnx', issue: { ...task, url: task.url } },
                  source,
                  repo.id,
                  project.name
                )
              ]
            : []
        )
      }
    })
  }
  return requests
}

export function openDevnxCmdJTask(
  result: CmdJTaskSearchResult,
  task: CmdJDevnxTask,
  createWorkspace: boolean
): void {
  const state = useAppStore.getState()
  if (createWorkspace) {
    const repo = state.repos.find((entry) => entry.id === result.initialRepoId) ?? null
    queueMicrotask(() => startWorkspaceFromDevnxTask(task.issue, repo, 'command_palette'))
    return
  }
  state.openTaskPage(
    {
      taskSource: 'devnx',
      openDevnxTaskId: task.issue.id,
      ...(result.initialRepoId ? { preselectedRepoId: result.initialRepoId } : {})
    },
    { recordTasksInteraction: false }
  )
}
