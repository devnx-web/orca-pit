import type { FilesystemPathFlavor } from './filesystem-entry-types'

// Orca-Pit: shortcuts the remote folder picker shows above the listing ("Locais").
export type OrcaPitServerLocationKind = 'home' | 'root' | 'disk'

export type OrcaPitServerLocation = {
  kind: OrcaPitServerLocationKind
  path: string
  // Last path segment for disks; the renderer translates the home/root labels.
  name: string
  // Space available to the server user, or null when statfs failed or timed out.
  freeBytes: number | null
}

export type OrcaPitServerLocations = {
  pathFlavor: FilesystemPathFlavor
  locations: OrcaPitServerLocation[]
}
