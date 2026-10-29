// Orca-Pit: "Online now" over the sidebar's project list: initials of the people connected to the
// central right now, with name, device and since when on hover. Hidden while one person is alone.
import React, { useMemo } from 'react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  getRepoExecutionHostId,
  LOCAL_EXECUTION_HOST_ID,
  type ExecutionHostId
} from '../../../../shared/execution-host'
import {
  deriveOrcaPitOnlineNow,
  type OrcaPitOnlinePerson
} from '../../../../shared/orca-pit-presence'
import { OrcaPitPersonAvatar } from './OrcaPitPersonAvatar'
import { useOrcaPitPolledHosts } from './orca-pit-sidebar-presence'

const MAX_AVATARS = 8

function sinceLabel(since: number): string {
  return new Date(since).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function PersonTooltip({ person }: { person: OrcaPitOnlinePerson }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-0.5 text-[11px]">
      <span className="font-semibold">{person.name}</span>
      {person.devices.map((device) => (
        <span key={`${device.central ? 'central' : device.device}:${device.since}`}>
          {translate('devnx.presence.deviceSince', '{{device}} · since {{time}}', {
            device: device.central
              ? translate('devnx.presence.centralComputer', 'Central computer')
              : device.device,
            time: sinceLabel(device.since)
          })}
        </span>
      ))}
    </div>
  )
}

export function OrcaPitOnlineNow(): React.JSX.Element | null {
  // A joined string, so the polls follow the set of hosts and not every repos update.
  const hostList = useAppStore((s) =>
    [...new Set(s.repos.map((repo) => getRepoExecutionHostId(repo)))].sort().join('\n')
  )
  const hostIds = useMemo<ExecutionHostId[]>(
    () => (hostList ? (hostList.split('\n') as ExecutionHostId[]) : [LOCAL_EXECUTION_HOST_ID]),
    [hostList]
  )
  const people = deriveOrcaPitOnlineNow(useOrcaPitPolledHosts(hostIds))
  if (people.length === 0) {
    return null
  }
  const label = translate('devnx.presence.onlineNow', 'Online now')
  const extra = people.length - MAX_AVATARS
  return (
    <div
      className="flex shrink-0 items-center gap-1.5 px-3 pb-1 pt-0.5"
      role="group"
      aria-label={label}
    >
      <span className="size-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden />
      <span className="shrink-0 text-[10px] font-medium text-muted-foreground">{label}</span>
      <span className="flex min-w-0 items-center -space-x-1">
        {people.slice(0, MAX_AVATARS).map((person) => (
          <Tooltip key={person.key}>
            <TooltipTrigger asChild>
              <span className="inline-flex rounded-full" tabIndex={0}>
                <OrcaPitPersonAvatar
                  personKey={person.key}
                  name={person.name}
                  size="sm"
                  className="ring-2 ring-worktree-sidebar"
                />
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={4}>
              <PersonTooltip person={person} />
            </TooltipContent>
          </Tooltip>
        ))}
      </span>
      {extra > 0 ? (
        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">+{extra}</span>
      ) : null}
    </div>
  )
}
