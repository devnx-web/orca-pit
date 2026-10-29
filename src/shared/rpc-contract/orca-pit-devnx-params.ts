// Orca-Pit: params of the DevNX Control reads (orcaPit.devnxProjects/devnxTasks/devnxTask).
// Ids are the Control's positive integers; the host clips search and limit again before the call.
import { z } from 'zod'

const ControlId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
// Why generous: a pasted search must not fail validation; the Control call keeps 200 chars.
const Search = z.string().max(1000).optional()

export const OrcaPitDevnxProjectsParams = z.object({
  /** The Orca project whose git remotes and name suggest the link. */
  repoId: z.string().min(1).max(1024).optional(),
  search: Search
})

export const OrcaPitDevnxTasksParams = z.object({
  projectId: ControlId,
  search: Search,
  statuses: z
    .array(z.string().regex(/^[a-z_]{1,32}$/))
    .max(16)
    .optional(),
  /** assignee=me: whoever's Control login answers (the person, or the central's owner). */
  mine: z.boolean().optional(),
  limit: z.number().int().min(1).max(200).optional()
})

export const OrcaPitDevnxTaskParams = z.object({ taskId: ControlId })
