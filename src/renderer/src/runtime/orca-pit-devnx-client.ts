// Orca-Pit: DevNX Control reads through the runtime RPC of the host that owns the Orca project,
// the same call from this window, a paired desktop and the browser. The host picks whose Control
// login answers; this side only routes and turns a transport failure into a result.
import { getRepoExecutionHostId } from '../../../shared/execution-host'
import type { Repo } from '../../../shared/repo-types'
import type { RuntimeClientTarget } from '../../../shared/runtime-client-target'
import {
  ORCA_PIT_DEVNX_DISCONNECTED,
  ORCA_PIT_DEVNX_METHODS as METHODS,
  parseOrcaPitDevnxResult,
  parseOrcaPitDevnxStatus,
  type OrcaPitDevnxProjectsResult,
  type OrcaPitDevnxResult,
  type OrcaPitDevnxStatus,
  type OrcaPitDevnxTaskResult,
  type OrcaPitDevnxTasksResult
} from '../../../shared/orca-pit-devnx-rpc'
import type { DevnxControlTaskQuery } from '../../../shared/orca-pit-devnx-tasks'
import { defaultScopeHost } from '@/lib/default-creation-host'
import { useAppStore } from '@/store'
import { ipcOrRuntimeTargetForHostId } from './runtime-client-target'
import { callRuntimeRpc } from './runtime-rpc-client'

const TIMEOUT_MS = 35_000

/** The host that owns the project; null when its host cannot be routed (never a guess). */
export function devnxTargetForRepo(
  repo: Pick<Repo, 'connectionId' | 'executionHostId'> | null | undefined
): RuntimeClientTarget | null {
  return repo ? ipcOrRuntimeTargetForHostId(getRepoExecutionHostId(repo)) : null
}

/** Where a row-less surface (Settings → Tasks) asks: the focused server, else this app. */
export function devnxDefaultTarget(): RuntimeClientTarget {
  return defaultScopeHost(useAppStore.getState().settings)
}

/** A string per host, so hooks re-run on a host change and not on a rebuilt target object. */
export function devnxTargetKey(target: RuntimeClientTarget): string {
  return target.kind === 'local' ? 'local' : `env:${target.environmentId}`
}

export function devnxTargetOfKey(key: string): RuntimeClientTarget {
  return key.startsWith('env:')
    ? { kind: 'environment', environmentId: key.slice('env:'.length) }
    : { kind: 'local' }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function call<T>(
  target: RuntimeClientTarget,
  method: string,
  params: unknown
): Promise<OrcaPitDevnxResult<T>> {
  try {
    const raw = await callRuntimeRpc<unknown>(target, method, params, { timeoutMs: TIMEOUT_MS })
    return parseOrcaPitDevnxResult<T>(raw)
  } catch (error) {
    // An Orca host without this feature has no such method: same as not connected.
    const message = errorText(error)
    return /method[_ ]not[_ ]found|unknown method/i.test(message)
      ? { ok: false, code: 'not_connected', error: message }
      : { ok: false, code: 'unavailable', error: message }
  }
}

export async function fetchDevnxStatus(target: RuntimeClientTarget): Promise<OrcaPitDevnxStatus> {
  try {
    return parseOrcaPitDevnxStatus(
      await callRuntimeRpc<unknown>(target, METHODS.status, undefined, { timeoutMs: 10_000 })
    )
  } catch {
    return ORCA_PIT_DEVNX_DISCONNECTED
  }
}

export function listDevnxProjects(
  target: RuntimeClientTarget,
  input: { repoId?: string; search?: string }
): Promise<OrcaPitDevnxProjectsResult> {
  return call(target, METHODS.projects, input)
}

export function listDevnxTasks(
  target: RuntimeClientTarget,
  query: DevnxControlTaskQuery
): Promise<OrcaPitDevnxTasksResult> {
  return call(target, METHODS.tasks, {
    projectId: query.projectId,
    ...(query.search ? { search: query.search } : {}),
    ...(query.statuses && query.statuses.length > 0 ? { statuses: [...query.statuses] } : {}),
    ...(query.mine ? { mine: true } : {}),
    ...(query.limit ? { limit: query.limit } : {})
  })
}

export function getDevnxTask(
  target: RuntimeClientTarget,
  taskId: number
): Promise<OrcaPitDevnxTaskResult> {
  return call(target, METHODS.task, { taskId })
}
