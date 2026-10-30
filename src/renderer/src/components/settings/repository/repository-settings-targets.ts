import type { SourceControlActionId } from '../../../../../shared/source-control-ai-actions'

export function getRepositoryLocalCommandsSectionId(repoId: string): string {
  return `repo-${repoId}-local-commands`
}

export function getRepositoryIconSectionId(repoId: string): string {
  return `repo-${repoId}-icon`
}

// Orca-Pit: the DevNX Control project link, opened from the sidebar's "Link" chip.
export function getRepositoryDevnxProjectSectionId(repoId: string): string {
  return `repo-${repoId}-devnx-project`
}

export function getRepositorySourceControlAiSectionId(repoId: string): string {
  return `repo-${repoId}-source-control-ai`
}

export function getRepositorySourceControlAiActionRecipeSectionId(
  repoId: string,
  actionId: SourceControlActionId
): string {
  return `repo-${repoId}-source-control-ai-${actionId}`
}
