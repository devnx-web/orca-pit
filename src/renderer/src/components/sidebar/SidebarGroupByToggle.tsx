import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { translate } from '@/i18n/i18n'
import type { WorktreeGroupBy } from './worktree-list/grouping/row-types'
import { GROUP_BY_OPTIONS } from './sidebar-workspace-option-items'
import { setAgentsOnlyView, useAgentsOnlyView } from './orca-pit-agents-view'

// Orca-Pit: "Agents" is not one of Orca's groupings; it is the project grouping showing only
// agents, so it selects 'repo' and flips the fork's own flag (see orca-pit-agents-view).
const AGENTS_OPTION_ID = 'orca-pit-agents'

type SidebarGroupByToggleProps = {
  groupBy: WorktreeGroupBy
  setGroupBy: (groupBy: WorktreeGroupBy) => void
}

export function SidebarGroupByToggle({ groupBy, setGroupBy }: SidebarGroupByToggleProps) {
  const agentsOnly = useAgentsOnlyView()
  const select = (value: string): void => {
    setAgentsOnlyView(value === AGENTS_OPTION_ID)
    setGroupBy(value === AGENTS_OPTION_ID ? 'repo' : (value as WorktreeGroupBy))
  }
  const options = [
    ...GROUP_BY_OPTIONS,
    { id: AGENTS_OPTION_ID, label: translate('devnx.groupBy.agents', 'Agents') }
  ]
  return (
    <ToggleGroup
      type="single"
      value={agentsOnly ? AGENTS_OPTION_ID : groupBy}
      onValueChange={(value) => {
        if (value) {
          select(value)
        }
      }}
      variant="outline"
      size="sm"
      className="h-6 w-full justify-stretch"
    >
      {options.map((option) => (
        <ToggleGroupItem
          key={option.id}
          value={option.id}
          // Why: inside the dropdown menu, Radix can focus a toggle item without
          // committing ToggleGroup's value change; capture the pointer intent
          // before the menu's roving-focus handling turns it into a no-op.
          onPointerDownCapture={() => select(option.id)}
          className="h-6 grow basis-0 px-1 text-[10px] data-[state=on]:bg-foreground/10 data-[state=on]:font-semibold data-[state=on]:text-foreground"
        >
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
