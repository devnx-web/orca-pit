// Orca-Pit: the "+" of a project header in the "Agents" view. A project merged over several
// machines asks where to create the workspace; with one it creates right away, as in Orca.
import type React from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import type { Repo } from '../../../../shared/repo-types'
import { getRepoExecutionHostId } from '../../../../shared/execution-host'
import { REPO_HEADER_ACTION_BUTTON_CLASS } from './repo-header-action-button-class'
import { RepoHeaderCreateWorkspaceButton } from './worktree-list/rows/repo-header-project-actions'
import {
  handleRepoHeaderActionPointerDown,
  stopRepoHeaderKeyboardToggle
} from './worktree-list/rows/header-event-guards'
import { OrcaPitMachineChip } from './OrcaPitMachineChip'

function MachineItem({
  repo,
  onCreateForRepo
}: {
  repo: Repo
  onCreateForRepo: (projectId: string) => void
}): React.JSX.Element {
  return (
    <DropdownMenuItem onSelect={() => onCreateForRepo(repo.id)} className="gap-2">
      <span className="min-w-0 flex-1 truncate">{repo.displayName}</span>
      <OrcaPitMachineChip hostId={getRepoExecutionHostId(repo)} />
    </DropdownMenuItem>
  )
}

export function OrcaPitCreateWorkspaceButton({
  repo,
  repos,
  label,
  onCreateForRepo
}: {
  repo: Repo
  repos: readonly Repo[] | undefined
  label: string
  onCreateForRepo: (projectId: string) => void
}): React.JSX.Element {
  if (!repos || repos.length < 2) {
    return (
      <RepoHeaderCreateWorkspaceButton
        repo={repo}
        label={label}
        onCreateForRepo={onCreateForRepo}
      />
    )
  }
  const ariaLabel = translate(
    'devnx.projectMerge.createWhere',
    'Create workspace for {{name}} on…',
    {
      name: label
    }
  )
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className={REPO_HEADER_ACTION_BUTTON_CLASS}
          data-repo-header-action=""
          aria-label={ariaLabel}
          onKeyDown={stopRepoHeaderKeyboardToggle}
          onPointerDown={handleRepoHeaderActionPointerDown}
          onClick={(event) => event.stopPropagation()}
        >
          <Plus className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {translate('devnx.projectMerge.createWhereTitle', 'Create the workspace on')}
        </DropdownMenuLabel>
        {repos.map((entry) => (
          <MachineItem key={entry.id} repo={entry} onCreateForRepo={onCreateForRepo} />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
