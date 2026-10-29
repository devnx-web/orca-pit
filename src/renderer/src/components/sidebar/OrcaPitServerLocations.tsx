import type React from 'react'
import { useEffect, useState } from 'react'
import { FolderRoot, HardDrive, Home } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getIntlLocale, translate } from '@/i18n/i18n'
import { fetchOrcaPitServerLocations } from '@/runtime/orca-pit-server-locations-client'
import {
  findActiveOrcaPitLocation,
  formatOrcaPitFreeSpace
} from './orca-pit-server-locations-helpers'
import type { FilesystemPathFlavor } from '../../../../shared/filesystem-entry-types'
import type { OrcaPitServerLocation } from '../../../../shared/orca-pit-server-locations'

type OrcaPitServerLocationsProps = {
  runtimeEnvironmentId: string
  resolvedPath: string
  pathFlavor: FilesystemPathFlavor
  loading: boolean
  navigate: (dirPath: string) => void
}

const ICONS = { home: Home, root: FolderRoot, disk: HardDrive } as const

function chipLabel(location: OrcaPitServerLocation): string {
  if (location.kind === 'home') {
    return translate('devnx.serverLocations.home', 'Home folder')
  }
  if (location.kind === 'root') {
    return translate('devnx.serverLocations.root', 'Root')
  }
  return location.name
}

// Orca-Pit: "Locais" row of the remote folder picker, so a second disk is one click away.
export function OrcaPitServerLocations({
  runtimeEnvironmentId,
  resolvedPath,
  pathFlavor,
  loading,
  navigate
}: OrcaPitServerLocationsProps): React.JSX.Element | null {
  const [locations, setLocations] = useState<OrcaPitServerLocation[]>([])

  // Fetched once per picker open; a failure leaves the row hidden.
  useEffect(() => {
    let cancelled = false
    void fetchOrcaPitServerLocations(runtimeEnvironmentId).then((result) => {
      if (!cancelled && result) {
        setLocations(result.locations)
      }
    })
    return () => {
      cancelled = true
    }
  }, [runtimeEnvironmentId])

  if (locations.length === 0) {
    return null
  }
  const active = findActiveOrcaPitLocation(locations, resolvedPath, pathFlavor)
  const locale = getIntlLocale()

  return (
    <div
      role="group"
      aria-label={translate('devnx.serverLocations.label', 'Places')}
      className="flex flex-wrap items-center gap-1"
    >
      <span className="text-[10px] text-muted-foreground mr-0.5">
        {translate('devnx.serverLocations.label', 'Places')}
      </span>
      {locations.map((location) => {
        const Icon = ICONS[location.kind]
        const isActive = location === active
        const free =
          location.freeBytes === null
            ? null
            : translate('devnx.serverLocations.free', '{{value0}} free', {
                value0: formatOrcaPitFreeSpace(location.freeBytes, locale)
              })
        return (
          <button
            key={`${location.kind}:${location.path}`}
            type="button"
            onClick={() => navigate(location.path)}
            disabled={loading}
            aria-pressed={isActive}
            title={location.path}
            className={cn(
              'flex items-center gap-1 h-6 max-w-[220px] px-2 rounded-full border text-[11px]',
              'transition-colors cursor-pointer disabled:cursor-default',
              isActive
                ? 'border-ring bg-accent text-foreground'
                : 'border-border text-muted-foreground hover:bg-accent hover:text-foreground'
            )}
          >
            <Icon className="size-3 shrink-0" />
            <span className="truncate">{chipLabel(location)}</span>
            {free && <span className="shrink-0 text-muted-foreground/80">· {free}</span>}
          </button>
        )
      })}
    </div>
  )
}
