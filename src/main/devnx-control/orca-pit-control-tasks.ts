// Orca-Pit: reads DevNX Control projects and tasks (contract routes 2-4) and maps the panel's
// snake_case payloads to the renderer's shapes. Anything malformed is dropped, never guessed.
import {
  isPositiveId,
  type DevnxControlProject,
  type DevnxControlTask,
  type DevnxControlTaskDetail,
  type DevnxControlTaskQuery,
  type DevnxControlUserRef
} from '../../shared/orca-pit-devnx-tasks'
import { DEVNX_CONTROL_API_PATHS as API, DevnxControlError, isRecord } from './devnx-control-http'

export type DevnxControlReader = { getJson: (apiPath: string) => Promise<unknown> }

// Why: the panel caps tasks at 200 and defaults to 50 (contract "formatos reais").
const MAX_TASK_LIMIT = 200
const MAX_SEARCH_LENGTH = 200
const MAX_DESCRIPTION_LENGTH = 20_000

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function numericId(value: unknown): number | null {
  const parsed = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  return isPositiveId(parsed) ? parsed : null
}

/** Only http(s) links reach shell.openExternal; anything else is dropped. */
export function safeWebUrl(value: unknown): string | null {
  const raw = text(value)
  if (!raw) {
    return null
  }
  try {
    const url = new URL(raw)
    return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password
      ? url.toString()
      : null
  } catch {
    return null
  }
}

function userRef(value: unknown): DevnxControlUserRef | null {
  if (!isRecord(value)) {
    return null
  }
  const id = numericId(value.id)
  const name = text(value.name)
  return id && name ? { id, name } : null
}

export function parseDevnxProject(value: unknown): DevnxControlProject | null {
  if (!isRecord(value)) {
    return null
  }
  const id = numericId(value.id)
  const name = text(value.name)
  if (!id || !name) {
    return null
  }
  const repositories = Array.isArray(value.repositories)
    ? value.repositories.map(text).filter((url): url is string => url !== null)
    : []
  return {
    id,
    name,
    client: text(value.client),
    status: text(value.status),
    // v1.2: the central session reads every company of its owner, so rows name theirs.
    tenant: userRef(value.tenant),
    repositories
  }
}

export function parseDevnxTask(value: unknown): DevnxControlTask | null {
  if (!isRecord(value)) {
    return null
  }
  const id = numericId(value.id)
  const title = text(value.title)
  if (!id || !title) {
    return null
  }
  const assignee = userRef(value.assignee)
  const assignees = Array.isArray(value.assignees)
    ? value.assignees.map(userRef).filter((user): user is DevnxControlUserRef => user !== null)
    : []
  const dueDate = text(value.due_date)
  return {
    id,
    title,
    status: text(value.status) ?? 'pending',
    priority: text(value.priority),
    assignee: assignee ?? assignees[0] ?? null,
    assignees: assignees.length > 0 ? assignees : assignee ? [assignee] : [],
    dueDate: dueDate && /^\d{4}-\d{2}-\d{2}/.test(dueDate) ? dueDate.slice(0, 10) : null,
    url: safeWebUrl(value.url),
    projectId: numericId(value.project_id),
    tenant: userRef(value.tenant)
  }
}

export function parseDevnxProjects(payload: unknown): DevnxControlProject[] {
  const list = isRecord(payload) && Array.isArray(payload.projects) ? payload.projects : null
  if (!list) {
    throw new DevnxControlError('Resposta inesperada do DevNX Control (projetos).', {
      code: 'INVALID_SERVER_RESPONSE'
    })
  }
  return list.map(parseDevnxProject).filter((p): p is DevnxControlProject => p !== null)
}

export function parseDevnxTasks(payload: unknown): DevnxControlTask[] {
  const list = isRecord(payload) && Array.isArray(payload.tasks) ? payload.tasks : null
  if (!list) {
    throw new DevnxControlError('Resposta inesperada do DevNX Control (tarefas).', {
      code: 'INVALID_SERVER_RESPONSE'
    })
  }
  return list.map(parseDevnxTask).filter((t): t is DevnxControlTask => t !== null)
}

export function parseDevnxTaskDetail(payload: unknown): DevnxControlTaskDetail {
  const raw = isRecord(payload) ? payload.task : null
  const task = parseDevnxTask(raw)
  if (!task || !isRecord(raw)) {
    throw new DevnxControlError('Resposta inesperada do DevNX Control (tarefa).', {
      code: 'INVALID_SERVER_RESPONSE'
    })
  }
  const description = typeof raw.description === 'string' ? raw.description.trim() : ''
  return { ...task, description: description ? description.slice(0, MAX_DESCRIPTION_LENGTH) : null }
}

/** `/api/orca/projects/24/tasks?status=pending,review&assignee=me&limit=50&search=…` */
export function devnxTasksPath(query: DevnxControlTaskQuery): string {
  if (!isPositiveId(query.projectId)) {
    throw new DevnxControlError('Projeto do DevNX Control inválido.', { code: 'INVALID_INPUT' })
  }
  const params = new URLSearchParams()
  const search = query.search?.trim().slice(0, MAX_SEARCH_LENGTH)
  if (search) {
    params.set('search', search)
  }
  const statuses = (query.statuses ?? []).filter((status) => /^[a-z_]+$/.test(status))
  if (statuses.length > 0) {
    params.set('status', statuses.join(','))
  }
  if (query.mine) {
    params.set('assignee', 'me')
  }
  const limit =
    typeof query.limit === 'number' && Number.isFinite(query.limit)
      ? Math.min(MAX_TASK_LIMIT, Math.max(1, Math.floor(query.limit)))
      : null
  if (limit) {
    params.set('limit', String(limit))
  }
  const suffix = params.toString()
  return `${API.orcaProjectTasks(query.projectId)}${suffix ? `?${suffix}` : ''}`
}

export async function listDevnxProjects(
  reader: DevnxControlReader,
  search?: string
): Promise<DevnxControlProject[]> {
  const term = search?.trim().slice(0, MAX_SEARCH_LENGTH)
  const path = term
    ? `${API.orcaProjects}?${new URLSearchParams({ search: term })}`
    : API.orcaProjects
  return parseDevnxProjects(await reader.getJson(path))
}

export async function listDevnxTasks(
  reader: DevnxControlReader,
  query: DevnxControlTaskQuery
): Promise<DevnxControlTask[]> {
  return parseDevnxTasks(await reader.getJson(devnxTasksPath(query)))
}

export async function getDevnxTask(
  reader: DevnxControlReader,
  taskId: number
): Promise<DevnxControlTaskDetail> {
  if (!isPositiveId(taskId)) {
    throw new DevnxControlError('Tarefa do DevNX Control inválida.', { code: 'INVALID_INPUT' })
  }
  return parseDevnxTaskDetail(await reader.getJson(API.orcaTask(taskId)))
}
