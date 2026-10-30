// Orca-Pit: shortcut chips (home, root, data disks) for the remote folder picker. Same scope as
// files.browseServerDir; lives here so Orca's files methods stay as upstream ships them.
import { defineMethod } from '../runtime/rpc/core'
import { listOrcaPitServerLocations } from './orca-pit-server-locations'

export const ORCA_PIT_SERVER_LOCATION_METHODS = [
  defineMethod({
    name: 'files.orcaPitServerLocations',
    permission: 'workspace',
    params: null,
    handler: async () => listOrcaPitServerLocations()
  })
]
