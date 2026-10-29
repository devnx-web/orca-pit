// Orca-Pit: the first name of whoever sent the last command to an agent, on its sidebar row.
import type React from 'react'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import { useOrcaPitAgentAuthor } from './orca-pit-agent-authors'

export function OrcaPitAgentAuthor({
  paneKey,
  worktreeId,
  highlighted = false
}: {
  paneKey: string
  worktreeId: string | null | undefined
  highlighted?: boolean
}): React.JSX.Element | null {
  const name = useOrcaPitAgentAuthor(worktreeId, paneKey)
  if (!name) {
    return null
  }
  return (
    <span
      className={cn(
        'max-w-20 shrink-0 truncate text-[10px]',
        highlighted ? 'text-foreground/70' : 'text-muted-foreground/70'
      )}
      title={translate('devnx.activity.lastCommandBy', 'Last command by {{name}}', { name })}
    >
      {name}
    </span>
  )
}
