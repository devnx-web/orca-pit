// Orca-Pit: DevNX Control projects and tasks (the panel's cards) inside Orca's Tasks.
// v1 only reads tasks and links workspaces to them; moving a card stays in the Control.

/** The Control project an Orca project is linked to, chosen by hand in the project settings. */
export type DevnxControlProjectReference = { id: number; name: string }

export const DEVNX_TASK_STATUSES = [
  'pending',
  'in_progress',
  'review',
  'blocked',
  'completed',
  'cancelled'
] as const
export type DevnxTaskStatus = (typeof DEVNX_TASK_STATUSES)[number]

/** The Tasks list default: everything still to do. */
export const DEVNX_OPEN_TASK_STATUSES: readonly DevnxTaskStatus[] = [
  'pending',
  'in_progress',
  'review',
  'blocked'
]

export type DevnxControlUserRef = { id: number; name: string }

/** The company a project or task belongs to; the central session reads all of its owner's. */
export type DevnxControlTenantRef = { id: number; name: string }

export type DevnxControlProject = {
  id: number
  name: string
  client: string | null
  status: string | null
  tenant: DevnxControlTenantRef | null
  /** Git URLs from the Control's ProjectRepository rows, used to suggest the link. */
  repositories: string[]
}

export type DevnxControlTask = {
  id: number
  title: string
  /** One of DEVNX_TASK_STATUSES; kept as text so a new panel status still shows. */
  status: string
  priority: string | null
  assignee: DevnxControlUserRef | null
  assignees: DevnxControlUserRef[]
  dueDate: string | null
  /** The task in the Control front; null when the panel sent no safe http(s) link. */
  url: string | null
  projectId: number | null
  tenant: DevnxControlTenantRef | null
}

export type DevnxControlTaskDetail = DevnxControlTask & { description: string | null }

export type DevnxControlTaskQuery = {
  projectId: number
  search?: string
  statuses?: readonly string[]
  /** assignee=me: the Control's "responsible or requester" of the central session. */
  mine?: boolean
  limit?: number
}

export type DevnxControlProjectSuggestionReason = 'remote' | 'name'

export type DevnxControlProjectList = {
  projects: DevnxControlProject[]
  suggestedProjectId: number | null
  suggestionReason: DevnxControlProjectSuggestionReason | null
}

export function isDevnxTaskStatus(value: unknown): value is DevnxTaskStatus {
  return DEVNX_TASK_STATUSES.includes(value as DevnxTaskStatus)
}

export function isPositiveId(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

/** null clears the link; undefined means the value is malformed and must be dropped. */
export function normalizeDevnxControlProjectReference(
  value: unknown
): DevnxControlProjectReference | null | undefined {
  if (value === null) {
    return null
  }
  if (!value || typeof value !== 'object' || !('id' in value) || !('name' in value)) {
    return undefined
  }
  const { id, name } = value
  if (!isPositiveId(id) || typeof name !== 'string' || !name.trim()) {
    return undefined
  }
  return { id, name: name.trim() }
}
