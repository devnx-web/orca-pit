// Orca-Pit: a person's initials in a colored circle, shared by agent rows and "online now".
import type React from 'react'
import { cn } from '@/lib/utils'
import { orcaPitInitials } from '../../../../shared/orca-pit-agent-authors'
import { orcaPitPersonTone } from './orca-pit-colors'

export function OrcaPitPersonAvatar({
  personKey,
  name,
  size = 'xs',
  title,
  className
}: {
  personKey: string
  name: string
  size?: 'xs' | 'sm'
  title?: string
  className?: string
}): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold leading-none',
        size === 'xs' ? 'size-3.5 text-[7px]' : 'size-5 text-[9px]',
        orcaPitPersonTone(personKey),
        className
      )}
      title={title}
      aria-label={title ?? name}
    >
      {orcaPitInitials(name)}
    </span>
  )
}
