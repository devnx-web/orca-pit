// Orca-Pit: which DevNX Control project and task a workspace works on, for whoever reports
// activity to the Control (contract route 5: project_id and task_id of each event).
import type { Repo } from '../../shared/repo-types'
import type { FolderWorkspace } from '../../shared/folder-workspace-types'
import type { WorktreeMeta } from '../../shared/worktree/meta-types'
import { getWorkspaceAttachments } from '../../shared/workspace-attachments'
import { getRepoIdFromWorktreeId } from '../../shared/worktree/id'
import { parseWorkspaceKey } from '../../shared/workspace-scope'
import { isPositiveId } from '../../shared/orca-pit-devnx-tasks'
import { mainProcessState as state } from '../startup/main-process-state'

export type OrcaPitControlLink = { projectId: number | null; taskId: number | null }

type LinkMetadata = Partial<
  Pick<WorktreeMeta, 'linkedWorkItem' | 'linkedItems' | 'linkedTaskSourceContext'>
>

export type OrcaPitWorkspaceLinkStore = {
  getRepo(id: string): Repo | undefined
  getWorktreeMeta(worktreeId: string): WorktreeMeta | undefined
  getFolderWorkspace?(id: string): FolderWorkspace | undefined
}

const NO_LINK: OrcaPitControlLink = { projectId: null, taskId: null }

/** The selected task wins; otherwise the first Control task among the workspace's links. */
export function devnxTaskIdFromLinks(meta: LinkMetadata | null | undefined): number | null {
  if (!meta) {
    return null
  }
  if (meta.linkedWorkItem?.provider === 'devnx' && isPositiveId(meta.linkedWorkItem.number)) {
    return meta.linkedWorkItem.number
  }
  const task = getWorkspaceAttachments(meta).find(
    (item) => item.provider === 'devnx' && item.type === 'issue' && isPositiveId(item.number)
  )
  return task?.number ?? null
}

export function resolveOrcaPitControlLink(
  repo: Pick<Repo, 'devnxControlProject'> | null | undefined,
  meta: LinkMetadata | null | undefined
): OrcaPitControlLink {
  const projectId = repo?.devnxControlProject?.id
  return {
    projectId: isPositiveId(projectId) ? projectId : null,
    taskId: devnxTaskIdFromLinks(meta)
  }
}

/**
 * Accepts a worktree id (`repoId::path`) or a workspace key (`worktree:…`, `folder:…`).
 * A folder workspace has no Orca project behind it, so only its task is known.
 */
export function devnxControlLinkForWorkspace(
  workspaceId: string,
  store: OrcaPitWorkspaceLinkStore | null = state.store
): OrcaPitControlLink {
  if (!store || !workspaceId) {
    return NO_LINK
  }
  const scope = parseWorkspaceKey(workspaceId)
  if (scope?.type === 'folder') {
    const folder = store.getFolderWorkspace?.(scope.folderWorkspaceId)
    return folder
      ? resolveOrcaPitControlLink(null, {
          linkedWorkItem: folder.linkedTask,
          linkedItems: folder.linkedItems,
          linkedTaskSourceContext: folder.linkedTaskSourceContext
        })
      : NO_LINK
  }
  const worktreeId = scope?.type === 'worktree' ? scope.worktreeId : workspaceId
  return resolveOrcaPitControlLink(
    store.getRepo(getRepoIdFromWorktreeId(worktreeId)),
    store.getWorktreeMeta(worktreeId)
  )
}
