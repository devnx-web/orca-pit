// Orca-Pit: who did it and where. Turns a request's caller into the person and device the
// diary signs, and a workspace id into the names (and Control project/task) the Control shows.
import { basename } from 'node:path'
import { splitWorktreeId } from '../../shared/worktree/id'
import type { RpcCallerIdentity } from '../runtime/rpc/rpc-caller-identity'
import { mainProcessState as state } from '../startup/main-process-state'
import { pairedDeviceName } from './orca-pit-activity-control'
import { orcaPitUserForDevice } from './orca-pit-identity'
import {
  devnxControlLinkForWorkspace,
  type OrcaPitWorkspaceLinkStore
} from './orca-pit-workspace-link'

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

export function workspaceContext(
  worktreeId: string | null | undefined,
  store: OrcaPitWorkspaceLinkStore | null = state.store
): OrcaPitWorkspaceContext {
  const parsed = worktreeId ? splitWorktreeId(worktreeId) : null
  if (!store || !worktreeId || !parsed) {
    return EMPTY_WORKSPACE_CONTEXT
  }
  const repo = store.getRepo(parsed.repoId)
  const meta = store.getWorktreeMeta(worktreeId)
  // The project picked in the project's settings and the Control card linked to the workspace.
  const link = devnxControlLinkForWorkspace(worktreeId, store)
  return {
    orca_project: repo?.displayName || (repo ? basename(repo.path) : '') || null,
    workspace: meta?.displayName || basename(parsed.worktreePath) || null,
    project_id: link.projectId,
    task_id: link.taskId
  }
}
