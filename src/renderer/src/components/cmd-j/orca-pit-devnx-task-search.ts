// Orca-Pit: DevNX Control tasks in the Cmd+J task search — one request per Control project
// linked to the searched Orca projects, open statuses only, like the other providers.
import type { Repo } from '../../../../shared/repo-types'
import {
  DEVNX_OPEN_TASK_STATUSES,
  type DevnxControlTask
} from '../../../../shared/orca-pit-devnx-tasks'
import { normalizeTaskSourceContext } from '../../../../shared/task-source-context'
import { useAppStore } from '@/store'
import { devnxFailureText, peekOrcaPitDevnxConnection } from '@/lib/orca-pit-devnx-status'
import { devnxTargetForRepo, listDevnxTasks } from '@/runtime/orca-pit-devnx-client'
import { getRepoExecutionHostId } from '../../../../shared/execution-host'
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
  const seen = new Set<number>()
  const requests: DevnxRequest[] = []
  for (const repo of args.repos) {
    const project = repo.devnxControlProject
    const target = devnxTargetForRepo(repo)
    // A host already known to have no Control session (or a stale login) is not asked.
    const known = target ? peekOrcaPitDevnxConnection(target) : null
    if (
      !project ||
      !target ||
      seen.has(project.id) ||
      (known && !known.checking && (!known.connected || known.needsLogin))
    ) {
      continue
    }
    seen.add(project.id)
    const source = normalizeTaskSourceContext({
      provider: 'devnx',
      projectId: getTaskPageRepoSourceContext(repo, 'github')?.projectId ?? repo.id,
      hostId: getRepoExecutionHostId(repo),
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
        const result = await listDevnxTasks(target, {
          projectId: project.id,
          search: args.query,
          statuses: DEVNX_OPEN_TASK_STATUSES,
          limit: args.limit
        })
        if (!result.ok) {
          if (result.code === 'not_connected') {
            return []
          }
          throw new Error(devnxFailureText(result))
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
