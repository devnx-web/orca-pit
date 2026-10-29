// Orca-Pit: lets every client (this window, the browser, a paired desktop) show who sent the
// last command to each agent pane. Read from memory; polling it costs a map copy.
import type { OrcaPitAgentAuthorsResult } from '../../shared/orca-pit-agent-authors'
import { defineMethod } from '../runtime/rpc/core'
import { orcaPitAgentAuthors } from './orca-pit-activity-hooks'

export const ORCA_PIT_ACTIVITY_METHODS = [
  defineMethod({
    name: 'orcaPit.agentAuthors',
    permission: 'workspace',
    params: null,
    handler: (): OrcaPitAgentAuthorsResult => ({ authors: orcaPitAgentAuthors() })
  })
]
