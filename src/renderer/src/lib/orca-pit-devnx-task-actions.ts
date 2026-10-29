// Orca-Pit: what a DevNX Control task can do from Orca in v1 — start a workspace linked to it,
// jump to the workspace already linked, or open the task in the Control front.
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import {
  activateAndRevealFolderWorkspace,
  activateAndRevealWorktree
} from '@/lib/worktree-activation'
import {
  getLinkedWorkItemSuggestedName,
  getLinkedWorkItemWorkspaceName,
  type LinkedWorkItemSummary
} from '@/lib/new-workspace'
import { getRepoWorkspaceCreationTargetHint } from '@/lib/project-host-workspace-target'
import { selectFolderWorkspaces } from '@/store/workspace-record-selectors'
import { folderWorkspaceToWorktree } from '../../../shared/folder-workspace-worktree'
import { parseWorkspaceKey } from '../../../shared/workspace-scope'
import { getWorkspaceAttachments } from '../../../shared/workspace-attachments'
import type { Repo } from '../../../shared/repo-types'
import type { Worktree } from '../../../shared/worktree/types'
import type { DevnxControlTask } from '../../../shared/orca-pit-devnx-tasks'

export function buildDevnxLinkedWorkItem(
  task: Pick<DevnxControlTask, 'id' | 'title' | 'url'>
): LinkedWorkItemSummary | null {
  // Why: a link without the Control URL could never be opened again from the sidebar.
  if (!task.url) {
    return null
  }
  return { provider: 'devnx', type: 'issue', number: task.id, title: task.title, url: task.url }
}

export function getDevnxTaskWorkspaceName(task: Pick<DevnxControlTask, 'id' | 'title'>): string {
  const item = { provider: 'devnx' as const, type: 'issue' as const, number: task.id }
  const named = { ...item, title: task.title }
  return getLinkedWorkItemWorkspaceName(named)?.seedName ?? getLinkedWorkItemSuggestedName(named)
}

export function findDevnxTaskWorkspace(
  taskId: number,
  workspaces: readonly Worktree[]
): Worktree | undefined {
  return workspaces
    .filter((workspace) => !workspace.isArchived)
    .find((workspace) =>
      getWorkspaceAttachments(workspace).some(
        (item) => item.provider === 'devnx' && item.type === 'issue' && item.number === taskId
      )
    )
}

function allWorkspaces(): Worktree[] {
  const state = useAppStore.getState()
  return [...state.allWorktrees(), ...selectFolderWorkspaces(state).map(folderWorkspaceToWorktree)]
}

export function openDevnxTaskWorkspace(workspace: Worktree): boolean {
  const scope = parseWorkspaceKey(workspace.id)
  const options = {
    navigationIntent: 'user-open' as const,
    ...(workspace.hostId ? { executionHostId: workspace.hostId } : {})
  }
  const activation =
    scope?.type === 'folder'
      ? activateAndRevealFolderWorkspace(scope.folderWorkspaceId, options)
      : activateAndRevealWorktree(workspace.id, options)
  return activation !== false
}

export function startWorkspaceFromDevnxTask(
  task: Pick<DevnxControlTask, 'id' | 'title' | 'url'>,
  repo: Repo | null,
  telemetrySource: 'sidebar' | 'command_palette' = 'sidebar'
): void {
  const linkedWorkItem = buildDevnxLinkedWorkItem(task)
  if (!linkedWorkItem) {
    toast.error(
      translate(
        'devnx.tasks.noUrl',
        'The DevNX Control did not send a link for this task, so it cannot be linked.'
      )
    )
    return
  }
  const state = useAppStore.getState()
  state.openModal('new-workspace-composer', {
    linkedWorkItem,
    initialRepoId: repo?.id,
    initialWorkspaceTarget: repo
      ? getRepoWorkspaceCreationTargetHint(repo, state.projectHostSetups)
      : undefined,
    prefilledName: getDevnxTaskWorkspaceName(task),
    telemetrySource
  })
}

/** Reuse the workspace already linked to the task; start a new one only when there is none. */
export function openOrStartDevnxTaskWorkspace(
  task: Pick<DevnxControlTask, 'id' | 'title' | 'url'>,
  repo: Repo | null
): void {
  const existing = findDevnxTaskWorkspace(task.id, allWorkspaces())
  if (existing && openDevnxTaskWorkspace(existing)) {
    return
  }
  startWorkspaceFromDevnxTask(task, repo)
}

export function openDevnxTaskInControl(url: string | null): void {
  if (url) {
    void window.api.shell.openUrl(url)
  }
}
