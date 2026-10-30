// Orca-Pit: every project header says which DevNX Control project it counts toward. A linked
// one opens that project in the Control; an unlinked one asks to be linked, since work done in
// it reaches the Control's workload without a project.
import type React from 'react'
import { ExternalLink, Link2 } from 'lucide-react'
import type { Repo } from '../../../../shared/repo-types'
import { DEVNX_CONTROL_WEB_URL } from '../../../../shared/devnx-control-types'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { useOrcaPitDevnxConnection } from '@/lib/orca-pit-devnx-status'
import { devnxTargetForRepo } from '@/runtime/orca-pit-devnx-client'
import { getRepositoryDevnxProjectSectionId } from '@/components/settings/repository/repository-settings-targets'

const CHIP =
  'inline-flex max-w-[8rem] shrink-0 items-center gap-0.5 rounded-[4px] border px-1 text-[10px] font-medium leading-[14px]'
const UNLINKED_TONE =
  'border-dashed border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-300'

export function controlProjectUrl(projectId: number): string {
  return `${DEVNX_CONTROL_WEB_URL}/projetos/${projectId}`
}

// The header toggles on click and arms a drag on pointer down; the chip's own click does neither.
function stop(event: React.SyntheticEvent): void {
  event.stopPropagation()
}

export function OrcaPitControlProjectChip({
  repo,
  onOpenRepoSettings
}: {
  repo: Repo | undefined
  onOpenRepoSettings: (projectId: string, sectionId?: string) => void
}): React.JSX.Element | null {
  const connection = useOrcaPitDevnxConnection(devnxTargetForRepo(repo))
  if (!repo || !connection.connected) {
    return null
  }
  const linked = repo.devnxControlProject ?? null
  if (linked) {
    return (
      <button
        type="button"
        data-repo-header-action=""
        className={cn(CHIP, 'border-border bg-muted/60 text-foreground hover:bg-accent')}
        title={translate('devnx.projectLink.openInControl', 'Open {{name}} in DevNX Control', {
          name: linked.name
        })}
        onPointerDown={stop}
        onKeyDown={stop}
        onClick={(event) => {
          stop(event)
          void window.api.shell.openUrl(controlProjectUrl(linked.id))
        }}
      >
        <span className="truncate">{linked.name}</span>
        <ExternalLink className="size-2.5 shrink-0 opacity-70" />
      </button>
    )
  }
  if (!connection.canLink) {
    // A member cannot change the link: the chip only tells them to ask an administrator.
    return (
      <span
        className={cn(CHIP, UNLINKED_TONE)}
        title={translate(
          'devnx.projectLink.unlinkedMember',
          'Not linked to a DevNX Control project. Ask an administrator to link it.'
        )}
      >
        <Link2 className="size-2.5 shrink-0" />
        <span className="truncate">
          {translate('devnx.projectLink.unlinkedShort', 'No Control project')}
        </span>
      </span>
    )
  }
  return (
    <button
      type="button"
      data-repo-header-action=""
      className={cn(CHIP, UNLINKED_TONE, 'hover:bg-amber-500/20')}
      title={translate(
        'devnx.projectLink.unlinkedAdmin',
        'Not linked to a DevNX Control project: work done here is not counted toward any project. Click to link it.'
      )}
      onPointerDown={stop}
      onKeyDown={stop}
      onClick={(event) => {
        stop(event)
        onOpenRepoSettings(repo.id, getRepositoryDevnxProjectSectionId(repo.id))
      }}
    >
      <Link2 className="size-2.5 shrink-0" />
      <span className="truncate">{translate('devnx.projectLink.linkAction', 'Link')}</span>
    </button>
  )
}
