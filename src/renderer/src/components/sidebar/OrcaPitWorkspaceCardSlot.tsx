// Orca-Pit: in the "Agents" view a workspace row draws only its agent rows, so the project
// header sits right above its agents; see orca-pit-agents-view.
import type React from 'react'
import { useAppStore } from '@/store'
import type { Repo } from '../../../../shared/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'
import {
  getSettingsFocusedExecutionHostId,
  getWorktreeExecutionHostId,
  LOCAL_EXECUTION_HOST_ID,
  parseExecutionHostId,
  toRuntimeExecutionHostId,
  toSshExecutionHostId,
  type ExecutionHostId
} from '../../../../shared/execution-host'
import { getHostDisplayLabelOverrides } from '../../../../shared/host-setting-overrides'
import WorktreeCardAgents from './WorktreeCardAgents'
import { WorktreeHostContextBadge } from './WorktreeHostContextBadge'
import { useAgentsOnlyView } from './orca-pit-agents-view'
import {
  getFlushWorktreeCardPaddingLeft,
  getWorktreeCardContentIndent
} from './worktree-list/rows/indentation'

// Why one indent: nested projects fold into their top-level header in this view, so every agent
// sits one step under it whatever depth its workspace had in the Project view.
const AGENT_ROW_CONTENT_INDENT = getWorktreeCardContentIndent({
  isGrouped: true,
  groupDepth: 0,
  lineageDepth: 0
})

type Props = {
  worktree: Worktree
  repo: Repo | undefined
  /** The workspace card, drawn whenever the "Agents" view is off. */
  children: React.ReactNode
}

// Same precedence as the dashboard's host labels: a user override, then the SSH target or
// paired-server name, then the raw id so the chip never goes blank.
function useHostLabel(hostId: ExecutionHostId): string {
  const sshTargetLabels = useAppStore((s) => s.sshTargetLabels)
  const runtimeEnvironments = useAppStore((s) => s.runtimeEnvironments)
  const settings = useAppStore((s) => s.settings)
  const override = getHostDisplayLabelOverrides(settings).get(hostId)
  if (override) {
    return override
  }
  const parsed = parseExecutionHostId(hostId)
  if (parsed?.kind === 'ssh') {
    const label = [...(sshTargetLabels ?? [])].find(
      ([targetId]) => toSshExecutionHostId(targetId) === hostId
    )?.[1]
    return label ?? parsed.targetId
  }
  if (parsed?.kind === 'runtime') {
    const environment = runtimeEnvironments?.find(
      (candidate) => toRuntimeExecutionHostId(candidate.id) === hostId
    )
    return environment?.name ?? parsed.environmentId
  }
  return hostId
}

function RemoteHostBadge({ hostId }: { hostId: ExecutionHostId }): React.JSX.Element {
  return <WorktreeHostContextBadge label={useHostLabel(hostId)} className="mt-1 shrink-0" />
}

export function OrcaPitWorkspaceCardSlot({ worktree, repo, children }: Props): React.JSX.Element {
  const agentsOnly = useAgentsOnlyView()
  const defaultHostId = useAppStore((s) => getSettingsFocusedExecutionHostId(s.settings))
  if (!agentsOnly) {
    return <>{children}</>
  }
  const hostId = getWorktreeExecutionHostId(worktree, repo, defaultHostId)
  return (
    <div
      className="flex items-start gap-1.5 pb-0.5 pr-1.5"
      style={{ paddingLeft: getFlushWorktreeCardPaddingLeft(AGENT_ROW_CONTENT_INDENT) }}
    >
      <div className="min-w-0 flex-1">
        <WorktreeCardAgents worktreeId={worktree.id} className="mt-0" listEveryAgent />
      </div>
      {/* Why only off this computer: a local chip on every row is noise; the remote one says
          which machine a click will reach. */}
      {hostId !== LOCAL_EXECUTION_HOST_ID && <RemoteHostBadge hostId={hostId} />}
    </div>
  )
}
