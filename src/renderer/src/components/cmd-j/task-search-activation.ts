import { useAppStore } from '@/store'
import { getPaletteWorktreeExecutionHostId } from '@/lib/palette-repo-resolution'
import { getWorkspaceAttachments } from '../../../../shared/workspace-attachments'
import {
  getProvenWorkspaceReferenceIdentity,
  parseWorkspaceReferenceUrl
} from '../../../../shared/workspace-reference-identity'
import { getLinearIssueWorkspaceName } from '../../../../shared/workspace-name'
import {
  getLinkedWorkItemWorkspaceName,
  getLinkedWorkItemSuggestedName,
  type LinkedWorkItemSummary
} from '@/lib/new-workspace'
import { buildLinearIssueLinkedWorkItem } from '@/lib/linear-linked-work-item'
import type { Worktree } from '../../../../shared/worktree/types'
import {
  haveConflictingTaskSourceAccounts,
  type TaskSourceContext
} from '../../../../shared/task-source-context'
import type { CmdJTaskSearchResult } from './task-search-results'
import { getJiraIssueWorkspaceSeed } from '../task-page/task-page-source-context'
// Orca-Pit: DevNX Control tasks.
import { openDevnxCmdJTask } from './orca-pit-devnx-task-search'
import { findDevnxTaskWorkspace } from '@/lib/orca-pit-devnx-task-actions'

function sourceMatches(source: TaskSourceContext, target: TaskSourceContext): boolean {
  if (source.provider !== target.provider || source.hostId !== target.hostId) {
    return false
  }
  if (haveConflictingTaskSourceAccounts(source, target)) {
    return false
  }
  const left = source.providerIdentity
  const right = target.providerIdentity
  return !(
    left?.provider === 'linear' &&
    right?.provider === 'linear' &&
    left.workspaceId &&
    right.workspaceId &&
    left.workspaceId !== right.workspaceId
  )
}

export function findCmdJTaskWorkspace(
  result: CmdJTaskSearchResult,
  workspaces: readonly Worktree[]
): Worktree | undefined {
  // Orca-Pit: a Control task is matched by its id, since its URL names no provider route.
  if (result.task.provider === 'devnx') {
    return findDevnxTaskWorkspace(result.task.issue.id, workspaces)
  }
  let identity: string | undefined
  try {
    identity = getProvenWorkspaceReferenceIdentity(
      parseWorkspaceReferenceUrl(result.task.issue.url, result.task.provider)
    )
  } catch {
    return undefined
  }
  if (!identity) {
    return undefined
  }
  return workspaces
    .filter((workspace) => !workspace.isArchived)
    .find((workspace) =>
      getWorkspaceAttachments(workspace).some((item) => {
        if (
          item.provider !== result.task.provider ||
          getProvenWorkspaceReferenceIdentity(item) !== identity
        ) {
          return false
        }
        // Legacy links have no source owner, so only their own execution host is safe.
        return item.taskSourceContext
          ? sourceMatches(item.taskSourceContext, result.sourceContext)
          : (getPaletteWorktreeExecutionHostId(workspace) ?? 'local') ===
              result.sourceContext.hostId
      })
    )
}

export function openCmdJTask(result: CmdJTaskSearchResult, createWorkspace = false): void {
  const state = useAppStore.getState()
  state.closeModal()
  const task = result.task
  // Orca-Pit: DevNX Control tasks open their own detail or start a linked workspace.
  if (task.provider === 'devnx') {
    openDevnxCmdJTask(result, task, createWorkspace)
    return
  }
  if (createWorkspace) {
    const linkedWorkItem: LinkedWorkItemSummary =
      task.provider === 'linear'
        ? buildLinearIssueLinkedWorkItem(task.issue)
        : {
            provider: task.provider,
            type: 'issue',
            number: task.provider === 'jira' ? 0 : task.issue.number,
            title: task.issue.title,
            url: task.issue.url,
            ...(task.provider === 'jira' ? { jiraIdentifier: task.issue.key } : {})
          }
    const prefilledName =
      task.provider === 'linear'
        ? getLinearIssueWorkspaceName(task.issue)
        : task.provider === 'jira'
          ? getJiraIssueWorkspaceSeed(task.issue)
          : (getLinkedWorkItemWorkspaceName(linkedWorkItem)?.seedName ??
            getLinkedWorkItemSuggestedName(linkedWorkItem))
    queueMicrotask(() =>
      useAppStore.getState().openModal('new-workspace-composer', {
        linkedWorkItem,
        prefilledName,
        initialRepoId: result.initialRepoId,
        taskSourceContext: result.sourceContext,
        telemetrySource: 'command_palette'
      })
    )
    return
  }
  const common = {
    taskSource: task.provider,
    ...(result.initialRepoId ? { preselectedRepoId: result.initialRepoId } : {})
  }
  state.openTaskPage(
    task.provider === 'linear'
      ? { ...common, openLinearIssue: task.issue, openLinearSourceContext: result.sourceContext }
      : task.provider === 'jira'
        ? { ...common, openJiraIssue: task.issue, openJiraSourceContext: result.sourceContext }
        : task.provider === 'github'
          ? {
              ...common,
              openGitHubWorkItem: task.issue,
              openGitHubSourceContext: result.sourceContext
            }
          : {
              ...common,
              openGitLabWorkItem: task.issue,
              openGitLabSourceContext: result.sourceContext
            },
    { recordTasksInteraction: false }
  )
}
