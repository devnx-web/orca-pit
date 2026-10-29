// Orca-Pit: lets every client (this window, the browser, a paired desktop) show who sent the
// last command to each agent pane, who is looking at it and who is connected. Read from memory;
// polling it costs a few map copies.
import type { OrcaPitAgentAuthorsResult } from '../../shared/orca-pit-presence'
import { defineMethod } from '../runtime/rpc/core'
import { orcaPitAgentAuthorsFor } from './orca-pit-activity-hooks'

export const ORCA_PIT_ACTIVITY_METHODS = [
  defineMethod({
    name: 'orcaPit.agentAuthors',
    permission: 'workspace',
    params: null,
    handler: (_params, { runtime, caller }): OrcaPitAgentAuthorsResult =>
      orcaPitAgentAuthorsFor(runtime, caller)
  })
]
