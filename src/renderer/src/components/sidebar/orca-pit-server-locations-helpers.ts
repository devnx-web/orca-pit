import type { FilesystemPathFlavor } from '../../../../shared/filesystem-entry-types'
import type { OrcaPitServerLocation } from '../../../../shared/orca-pit-server-locations'

const UNITS = ['KB', 'MB', 'GB', 'TB', 'PB'] as const

// Decimal units, as disk vendors and `df -H` print them ("349 GB", "1.8 TB" / "1,8 TB").
export function formatOrcaPitFreeSpace(bytes: number, locale = 'en-US'): string {
  let value = Math.max(0, bytes) / 1000
  let unit = 0
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000
    unit++
  }
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10
  // 999.6 GB rounds to 1000; show it as the next unit instead.
  if (rounded >= 1000 && unit < UNITS.length - 1) {
    return `1 ${UNITS[unit + 1]}`
  }
  return `${new Intl.NumberFormat(locale).format(rounded)} ${UNITS[unit]}`
}

function normalize(path: string, pathFlavor: FilesystemPathFlavor): string {
  if (pathFlavor === 'posix') {
    return path.length > 1 ? path.replace(/\/+$/, '') : path
  }
  // Drive paths compare case-insensitively with either separator.
  const unified = path.replace(/\//g, '\\').toLowerCase()
  return /^[a-z]:\\$/.test(unified) ? unified : unified.replace(/\\+$/, '')
}

function contains(
  location: OrcaPitServerLocation,
  current: string,
  pathFlavor: FilesystemPathFlavor
): boolean {
  // On Windows `/` is only the drive list, not an ancestor of every drive.
  if (location.kind === 'root') {
    return pathFlavor === 'posix' || current === '/'
  }
  const base = normalize(location.path, pathFlavor)
  const separator = pathFlavor === 'win32' ? '\\' : '/'
  return current === base || current.startsWith(base.endsWith(separator) ? base : base + separator)
}

// The innermost location holding the path is the active chip, so /media/x/Dados wins over root.
export function findActiveOrcaPitLocation(
  locations: readonly OrcaPitServerLocation[],
  resolvedPath: string,
  pathFlavor: FilesystemPathFlavor
): OrcaPitServerLocation | null {
  if (!resolvedPath) {
    return null
  }
  const current = resolvedPath === '/' ? '/' : normalize(resolvedPath, pathFlavor)
  let best: OrcaPitServerLocation | null = null
  for (const location of locations) {
    if (!contains(location, current, pathFlavor)) {
      continue
    }
    if (best === null || location.path.length > best.path.length) {
      best = location
    }
  }
  return best
}
