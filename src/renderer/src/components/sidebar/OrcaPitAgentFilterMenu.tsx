// Orca-Pit: the "Mine", person and machine filters under "Group by" in the list options. They
// narrow the list and the keyboard order alike; see orca-pit-agent-filters.
import React, { useMemo } from 'react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import {
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu'
import {
  getRepoExecutionHostId,
  normalizeExecutionHostId,
  type ExecutionHostId
} from '../../../../shared/execution-host'
import {
  orcaPitKnownPeople,
  setOrcaPitAgentFilters,
  useOrcaPitAgentFilters
} from './orca-pit-agent-filters'
import { OrcaPitMachineChip, useOrcaPitMachineLabel } from './OrcaPitMachineChip'
import { OrcaPitPersonAvatar } from './OrcaPitPersonAvatar'
import { useOrcaPitPolledHosts } from './orca-pit-sidebar-presence'

const EVERYONE = '__orca-pit-everyone__'

function useRepoHostIds(): ExecutionHostId[] {
  // A joined string, so the menu follows the set of hosts and not every repos update.
  const hostList = useAppStore((s) =>
    [...new Set(s.repos.map((repo) => getRepoExecutionHostId(repo)))].sort().join('\n')
  )
  return useMemo(() => (hostList ? (hostList.split('\n') as ExecutionHostId[]) : []), [hostList])
}

function SubTriggerLabel({
  label,
  value
}: {
  label: string
  value: React.ReactNode
}): React.JSX.Element {
  return (
    <span className="flex flex-1 items-center justify-between gap-2">
      <span>{label}</span>
      <span className="max-w-24 truncate text-[11px] font-medium text-muted-foreground">
        {value}
      </span>
    </span>
  )
}

function SelectedMachineName({ hostId }: { hostId: ExecutionHostId }): React.JSX.Element {
  return <>{useOrcaPitMachineLabel(hostId)}</>
}

export function OrcaPitAgentFilterMenu({
  preserveOpen
}: {
  preserveOpen: boolean
}): React.JSX.Element {
  const filters = useOrcaPitAgentFilters()
  const hostIds = useRepoHostIds()
  const people = orcaPitKnownPeople(useOrcaPitPolledHosts(hostIds))
  const everyone = translate('devnx.filters.everyone', 'Everyone')
  const personName =
    people.find((person) => person.key === filters.person)?.name ??
    (filters.person ? '…' : everyone)
  const subContentProps = {
    className: 'w-52',
    'data-workspace-board-preserve-open': preserveOpen ? '' : undefined
  }
  return (
    <>
      <DropdownMenuCheckboxItem
        checked={filters.mine}
        onCheckedChange={(checked) => setOrcaPitAgentFilters({ mine: checked === true })}
        // Keep the menu open so filters can be combined.
        onSelect={(e) => e.preventDefault()}
      >
        {translate('devnx.filters.mine', 'My agents')}
      </DropdownMenuCheckboxItem>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <SubTriggerLabel label={translate('devnx.filters.person', 'Person')} value={personName} />
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent {...subContentProps}>
          <DropdownMenuRadioGroup
            value={filters.person ?? EVERYONE}
            onValueChange={(value) =>
              setOrcaPitAgentFilters({ person: value === EVERYONE ? null : value })
            }
          >
            <DropdownMenuRadioItem value={EVERYONE} onSelect={(e) => e.preventDefault()}>
              {everyone}
            </DropdownMenuRadioItem>
            {people.map((person) => (
              <DropdownMenuRadioItem
                key={person.key}
                value={person.key}
                onSelect={(e) => e.preventDefault()}
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <OrcaPitPersonAvatar personKey={person.key} name={person.name} />
                  <span className="truncate">{person.name}</span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <SubTriggerLabel
            label={translate('devnx.filters.machine', 'Machine')}
            value={
              filters.host ? (
                <SelectedMachineName hostId={filters.host} />
              ) : (
                translate('devnx.filters.allMachines', 'All')
              )
            }
          />
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent {...subContentProps}>
          <DropdownMenuRadioGroup
            value={filters.host ?? EVERYONE}
            onValueChange={(value) =>
              setOrcaPitAgentFilters({
                host: value === EVERYONE ? null : normalizeExecutionHostId(value)
              })
            }
          >
            <DropdownMenuRadioItem value={EVERYONE} onSelect={(e) => e.preventDefault()}>
              {translate('devnx.filters.allMachines', 'All')}
            </DropdownMenuRadioItem>
            {hostIds.map((hostId) => (
              <DropdownMenuRadioItem
                key={hostId}
                value={hostId}
                onSelect={(e) => e.preventDefault()}
              >
                <OrcaPitMachineChip hostId={hostId} />
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </>
  )
}
