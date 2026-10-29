// Orca-Pit: who did it and where. Turns a request's caller into the person and device the
// diary signs, and a workspace id into the names (and Control project/task) the Control shows.
import { basename } from 'node:path'
import { splitWorktreeId } from '../../shared/worktree/id'
import type { RpcCallerIdentity } from '../runtime/rpc/rpc-caller-identity'
import { mainProcessState as state } from '../startup/main-process-state'
import { isRecord } from './devnx-control-http'
import { pairedDeviceName } from './orca-pit-activity-control'
import { orcaPitUserForDevice } from './orca-pit-identity'

export type OrcaPitActor = {
  userId: number | null
  name: string | null
  deviceLabel: string
  /** This machine's own owner: the user id is filled in before sending if still unknown. */
  localActor: boolean
  /** The `orca` CLI, which agents use; their writes are not a person's command. */
  programmatic: boolean
}

export type OrcaPitWorkspaceContext = {
  orca_project: string | null
  workspace: string | null
  project_id: number | null
  task_id: number | null
}

export const EMPTY_WORKSPACE_CONTEXT: OrcaPitWorkspaceContext = {
  orca_project: null,
  workspace: null,
  project_id: null,
  task_id: null
}

export function firstName(name: string | null | undefined): string | null {
  const first = (name ?? '').trim().split(/\s+/)[0]
  return first ? first : null
}

export function actorForCaller(caller: RpcCallerIdentity | undefined): OrcaPitActor {
  if (caller?.kind === 'paired-device') {
    const user = orcaPitUserForDevice(caller.deviceId)
    const device = pairedDeviceName(caller.deviceId) ?? 'aparelho'
    const who = user?.name ?? 'Sem login'
    return {
      userId: user?.id ?? null,
      name: user?.name ?? null,
      // A browser login already names its device "<Nome> · navegador".
      deviceLabel: (device.startsWith(`${who} ·`) ? device : `${who} · ${device}`).slice(0, 120),
      localActor: false,
      programmatic: false
    }
  }
  // A local caller (this window, the local CLI) is the owner of the central Control session.
  const owner = orcaPitUserForDevice(null)
  const desktop = caller?.kind === 'desktop'
  return {
    userId: owner?.id ?? null,
    name: owner?.name ?? null,
    deviceLabel: `${owner?.name ?? 'Computador central'} · ${desktop ? 'app' : 'CLI'}`.slice(
      0,
      120
    ),
    localActor: true,
    programmatic: !desktop
  }
}

function positiveInt(value: unknown): number | null {
  const parsed = typeof value === 'string' ? Number(value) : value
  return typeof parsed === 'number' && Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function linkedId(source: unknown, keys: readonly string[]): number | null {
  if (!isRecord(source)) {
    return null
  }
  for (const key of keys) {
    const value = source[key]
    const direct = positiveInt(value)
    if (direct !== null) {
      return direct
    }
    if (isRecord(value)) {
      const nested = positiveInt(value.id)
      if (nested !== null) {
        return nested
      }
    }
  }
  return null
}

// Why defensive: the project/task link is added by another change; any of these names works
// and an absent link leaves both ids null.
const PROJECT_LINK_KEYS = [
  'orcaPitControlProject',
  'orcaPitControlProjectId',
  'devnxControlProject',
  'devnxControlProjectId'
]
const TASK_LINK_KEYS = [
  'orcaPitControlTask',
  'orcaPitControlTaskId',
  'devnxControlTask',
  'devnxControlTaskId'
]

export function readControlLink(
  repo: unknown,
  meta: unknown
): Pick<OrcaPitWorkspaceContext, 'project_id' | 'task_id'> {
  return {
    project_id: linkedId(meta, PROJECT_LINK_KEYS) ?? linkedId(repo, PROJECT_LINK_KEYS),
    task_id: linkedId(meta, TASK_LINK_KEYS)
  }
}

export function workspaceContext(worktreeId: string | null | undefined): OrcaPitWorkspaceContext {
  const store = state.store
  const parsed = worktreeId ? splitWorktreeId(worktreeId) : null
  if (!store || !worktreeId || !parsed) {
    return EMPTY_WORKSPACE_CONTEXT
  }
  const repo = store.getRepo(parsed.repoId)
  const meta = store.getWorktreeMeta(worktreeId)
  return {
    orca_project: repo?.displayName || (repo ? basename(repo.path) : '') || null,
    workspace: meta?.displayName || basename(parsed.worktreePath) || null,
    ...readControlLink(repo, meta)
  }
}
