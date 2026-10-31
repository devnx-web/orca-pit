// Orca-Pit: lets every client (this window, the browser, a paired desktop) show who sent the
// last command to each agent pane, who is looking at it and who is connected. Read from memory;
// polling it costs a few map copies.
import type { OrcaPitAgentAuthorsResult } from '../../shared/orca-pit-presence'
import {
  OrcaPitPresenceParams,
  type OrcaPitPresenceResult
} from '../../shared/rpc-contract/orca-pit-presence-params'
import { defineMethod } from '../runtime/rpc/core'
import { orcaPitAgentAuthorsFor, recordOrcaPitPresence } from './orca-pit-activity-hooks'

export const ORCA_PIT_ACTIVITY_METHODS = [
  defineMethod({
    name: 'orcaPit.agentAuthors',
    permission: 'workspace',
    params: null,
    handler: (_params, { runtime, caller }): OrcaPitAgentAuthorsResult =>
      orcaPitAgentAuthorsFor(runtime, caller)
  }),
  // The browser's idle screen: signed by the person of its login, on this computer's diary.
  defineMethod({
    name: 'orcaPit.presence',
    permission: 'workspace',
    params: OrcaPitPresenceParams,
    handler: (params, { caller }): OrcaPitPresenceResult => recordOrcaPitPresence(caller, params)
  })
]
