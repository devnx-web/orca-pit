// Orca-Pit: a person's Control photo, or their initials in a colored circle when there is none (or
// it fails to load); shared by agent rows, "online now" and the app's own sign-in chip.
import type React from 'react'
import { useState } from 'react'
import { cn } from '@/lib/utils'
import { orcaPitInitials } from '../../../../shared/orca-pit-agent-authors'
import { orcaPitPersonTone } from './orca-pit-colors'
import { useOrcaPitAvatarUrl } from './orca-pit-sidebar-presence'

const SIZE_CLASS = {
  xs: 'size-3.5 text-[7px]',
  sm: 'size-5 text-[9px]',
  md: 'size-7 text-[11px]'
} as const

export function OrcaPitPersonAvatar({
  personKey,
  name,
  size = 'xs',
  title,
  className,
  avatarUrl
}: {
  personKey: string
  name: string
  size?: keyof typeof SIZE_CLASS
  title?: string
  className?: string
  /** A photo the caller already knows; otherwise the hosts' presence names one. */
  avatarUrl?: string | null
}): React.JSX.Element {
  const known = useOrcaPitAvatarUrl(personKey)
  const url = avatarUrl ?? known
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const showPhoto = url !== null && url !== failedUrl
  return (
    <span
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full font-semibold leading-none',
        SIZE_CLASS[size],
        !showPhoto && orcaPitPersonTone(personKey),
        className
      )}
      title={title}
      aria-label={title ?? name}
    >
      {showPhoto ? (
        <img
          src={url}
          alt=""
          className="size-full object-cover"
          referrerPolicy="no-referrer"
          draggable={false}
          onError={() => setFailedUrl(url)}
        />
      ) : (
        orcaPitInitials(name)
      )}
    </span>
  )
}
