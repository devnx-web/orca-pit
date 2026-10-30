// Orca-Pit: the colored machine chip of the "Agents" view, on an agent row; orca-pit-machine-chips
// decides which rows name their machine. Replaces the plain host badge remote agents had.
import type React from 'react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import {
  getLocalExecutionHostLabel,
  toRuntimeExecutionHostId,
  toSshExecutionHostId,
  type ExecutionHostId
} from '../../../../shared/execution-host'
import { getHostDisplayLabelOverrides } from '../../../../shared/host-setting-overrides'
import { orcaPitMachineTone } from './orca-pit-colors'
import { resolveOrcaPitMachineLabel, useOrcaPitRowMachine } from './orca-pit-machine-chips'
import { useOrcaPitMachineName } from './orca-pit-sidebar-presence'

export function useOrcaPitMachineLabel(hostId: ExecutionHostId): string {
  // Each selector returns a string, so a chip re-renders only when its own name changes.
  const override = useAppStore((s) => getHostDisplayLabelOverrides(s.settings).get(hostId) ?? null)
  const sshLabel = useAppStore(
    (s) =>
      [...(s.sshTargetLabels ?? [])].find(
        ([targetId]) => toSshExecutionHostId(targetId) === hostId
      )?.[1] ?? null
  )
  const environmentName = useAppStore(
    (s) =>
      s.runtimeEnvironments?.find(
        (environment) => toRuntimeExecutionHostId(environment.id) === hostId
      )?.name ?? null
  )
  const machineName = useOrcaPitMachineName(hostId)
  return resolveOrcaPitMachineLabel({
    hostId,
    override,
    sshLabel,
    environmentName,
    machineName,
    localFallback: getLocalExecutionHostLabel()
  })
}

export function OrcaPitMachineChip({
  hostId,
  className
}: {
  hostId: ExecutionHostId
  className?: string
}): React.JSX.Element {
  const label = useOrcaPitMachineLabel(hostId)
  return (
    <span
      className={cn(
        'inline-flex max-w-[6.5rem] shrink-0 items-center rounded-[4px] border px-1 text-[10px] font-medium leading-[14px]',
        orcaPitMachineTone(label),
        className
      )}
      title={translate('devnx.machine.runsOn', 'Runs on {{name}}', { name: label })}
    >
      <span className="truncate">{label}</span>
    </span>
  )
}

/** On an agent row, when its project spreads over more than one machine. */
export function OrcaPitRowMachineChip({
  worktreeId
}: {
  worktreeId: string | null | undefined
}): React.JSX.Element | null {
  const hostId = useOrcaPitRowMachine(worktreeId)
  return hostId ? <OrcaPitMachineChip hostId={hostId} /> : null
}
