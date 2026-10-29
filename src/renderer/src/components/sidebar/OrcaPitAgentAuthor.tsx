// Orca-Pit: the people and the machine on an agent's sidebar row: who is looking at it right
// now, who sent the last command ("Fabio · 3m") and, when machines are mixed, where it runs.
import React, { useMemo } from 'react'
import { Eye } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { useNow } from '@/hooks/use-now'
import { cn } from '@/lib/utils'
import {
  orcaPitAuthorKey,
  orcaPitAuthorLine,
  orcaPitFirstName
} from '../../../../shared/orca-pit-agent-authors'
import { otherViewers } from '../../../../shared/orca-pit-presence'
import { OrcaPitPersonAvatar } from './OrcaPitPersonAvatar'
import { OrcaPitRowMachineChip } from './OrcaPitMachineChip'
import {
  useOrcaPitPaneAuthor,
  useOrcaPitPaneViewers,
  useOrcaPitSelfKey
} from './orca-pit-sidebar-presence'

const MAX_VIEWER_AVATARS = 3
const AGE_TICK_MS = 30_000

type Props = {
  paneKey: string
  worktreeId: string | null | undefined
  highlighted?: boolean
}

function PaneViewers({ paneKey, worktreeId }: Props): React.JSX.Element | null {
  const viewers = useOrcaPitPaneViewers(worktreeId, paneKey)
  const selfKey = useOrcaPitSelfKey(worktreeId)
  // Why leave yourself out: your own initials on the row you are looking at say nothing.
  const others = useMemo(
    () => otherViewers(viewers, new Set(selfKey ? [selfKey] : [])),
    [viewers, selfKey]
  )
  if (others.length === 0) {
    return null
  }
  const names = others.map((viewer) => orcaPitFirstName(viewer.name) ?? viewer.name).join(', ')
  const extra = others.length - MAX_VIEWER_AVATARS
  return (
    <span
      className="flex shrink-0 items-center"
      title={translate('devnx.presence.viewing', 'Looking at it now: {{names}}', { names })}
    >
      <Eye className="mr-0.5 size-3 text-muted-foreground/70" aria-hidden />
      <span className="flex items-center -space-x-1">
        {others.slice(0, MAX_VIEWER_AVATARS).map((viewer) => (
          <OrcaPitPersonAvatar
            key={viewer.key}
            personKey={viewer.key}
            name={viewer.name}
            className="ring-1 ring-worktree-sidebar"
          />
        ))}
      </span>
      {extra > 0 ? (
        <span className="pl-0.5 text-[9px] tabular-nums text-muted-foreground">+{extra}</span>
      ) : null}
    </span>
  )
}

function AuthorLine({ paneKey, worktreeId, highlighted = false }: Props): React.JSX.Element | null {
  const author = useOrcaPitPaneAuthor(worktreeId, paneKey)
  const now = useNow(AGE_TICK_MS, author !== null)
  const line = author
    ? orcaPitAuthorLine(author, now, translate('devnx.activity.justNow', 'now'))
    : null
  if (!author || !line) {
    return null
  }
  const title = translate(
    'devnx.activity.lastCommandByAt',
    'Last command by {{name}} at {{time}}',
    {
      name: author.name,
      time: new Date(author.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    }
  )
  return (
    <span
      className={cn(
        'flex max-w-24 shrink-0 items-center gap-0.5 text-[10px]',
        highlighted ? 'text-foreground/70' : 'text-muted-foreground/70'
      )}
      title={title}
    >
      <OrcaPitPersonAvatar personKey={orcaPitAuthorKey(author)} name={author.name} />
      <span className="min-w-0 truncate tabular-nums">{line}</span>
    </span>
  )
}

export function OrcaPitAgentAuthor(props: Props): React.JSX.Element {
  return (
    <>
      <PaneViewers {...props} />
      <AuthorLine {...props} />
      <OrcaPitRowMachineChip worktreeId={props.worktreeId} />
    </>
  )
}
