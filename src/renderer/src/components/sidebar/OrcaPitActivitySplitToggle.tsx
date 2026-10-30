// Orca-Pit: turns the Active/Inactive project sections on and off; see orca-pit-project-activity.
import { Zap } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { FilterToggleRow } from './FilterToggleRow'
import { useSplitProjectsByActivity } from './orca-pit-project-activity'
import { useAgentsOnlyView } from './orca-pit-agents-view'

export function OrcaPitActivitySplitToggle(): React.JSX.Element | null {
  const [enabled, setEnabled] = useSplitProjectsByActivity()
  const agentsView = useAgentsOnlyView()
  // The "Agents" view orders projects by their newest agent; the split serves the Project view.
  if (agentsView) {
    return null
  }
  return (
    <FilterToggleRow
      icon={<Zap className="size-3.5" />}
      label={translate('devnx.activity.split', 'Split active and inactive')}
      ariaLabel={translate(
        'devnx.activity.splitDescription',
        'Show projects with a message sent in the last 12 hours under Active and the rest under Inactive'
      )}
      checked={enabled}
      onChange={setEnabled}
    />
  )
}
