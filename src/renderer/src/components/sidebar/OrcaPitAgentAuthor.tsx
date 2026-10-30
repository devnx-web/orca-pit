// Orca-Pit: the people and the machine on an agent's sidebar row: the photos of whoever is on it
// (looking at it now, or the last to send it a command), yourself included, then where it runs.
import React, { useMemo } from 'react'
import { translate } from '@/i18n/i18n'
import { useNow } from '@/hooks/use-now'
import { orcaPitRowPeople, orcaPitRowPeopleTitle } from '../../../../shared/orca-pit-row-people'
import { OrcaPitPersonAvatar } from './OrcaPitPersonAvatar'
import { OrcaPitRowMachineChip } from './OrcaPitMachineChip'
import { useOrcaPitPaneAuthor, useOrcaPitPaneViewers } from './orca-pit-sidebar-presence'

const MAX_AVATARS = 3
const AGE_TICK_MS = 30_000

type Props = {
  paneKey: string
  worktreeId: string | null | undefined
  highlighted?: boolean
}

const WORDS = {
  viewing: (name: string) => translate('devnx.people.viewing', '{{name}} (looking now)', { name }),
  lastCommand: (name: string, age: string) =>
    translate('devnx.people.lastCommand', '{{name}} (last command {{age}} ago)', { name, age }),
  lastCommandNow: (name: string) =>
    translate('devnx.people.lastCommandNow', '{{name}} (last command just now)', { name }),
  both: (name: string, age: string) =>
    translate('devnx.people.both', '{{name}} (looking now, last command {{age}} ago)', {
      name,
      age
    }),
  bothNow: (name: string) =>
    translate('devnx.people.bothNow', '{{name}} (looking now, last command just now)', { name })
}

function RowPeople({ paneKey, worktreeId }: Props): React.JSX.Element | null {
  const viewers = useOrcaPitPaneViewers(worktreeId, paneKey)
  const author = useOrcaPitPaneAuthor(worktreeId, paneKey)
  const people = useMemo(() => orcaPitRowPeople(viewers, author), [viewers, author])
  const now = useNow(AGE_TICK_MS, author !== null)
  if (people.length === 0) {
    return null
  }
  const title = orcaPitRowPeopleTitle(people, now, {
    ...WORDS,
    nowWord: translate('devnx.activity.justNow', 'now')
  })
  const extra = people.length - MAX_AVATARS
  return (
    <span className="flex shrink-0 items-center" title={title}>
      <span className="flex items-center -space-x-1">
        {people.slice(0, MAX_AVATARS).map((person) => (
          <OrcaPitPersonAvatar
            key={person.key}
            personKey={person.key}
            name={person.name}
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

export function OrcaPitAgentAuthor(props: Props): React.JSX.Element {
  return (
    <>
      <RowPeople {...props} />
      <OrcaPitRowMachineChip worktreeId={props.worktreeId} />
    </>
  )
}
