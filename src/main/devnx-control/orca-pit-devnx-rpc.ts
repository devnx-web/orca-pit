// Orca-Pit: DevNX Control projects and tasks over the runtime RPC, so this window, a paired
// desktop and the browser all read them the same way. The host answers with the caller's own
// Control login when it has one (orca-pit-control-reader). Read-only: v1 never moves a card.
import { defineMethod } from '../runtime/rpc/core'
import {
  ORCA_PIT_DEVNX_DISCONNECTED,
  ORCA_PIT_DEVNX_METHODS as METHODS,
  type OrcaPitDevnxErrorCode,
  type OrcaPitDevnxResult,
  type OrcaPitDevnxStatus
} from '../../shared/orca-pit-devnx-rpc'
import {
  OrcaPitDevnxProjectsParams,
  OrcaPitDevnxTaskParams,
  OrcaPitDevnxTasksParams
} from '../../shared/rpc-contract/orca-pit-devnx-params'
import { mainProcessState as state } from '../startup/main-process-state'
import { DevnxControlError, publicErrorMessage } from './devnx-control-http'
import { getDevnxControlService } from './devnx-control-service'
import type { OrcaPitCentralSession } from './orca-pit-control-me'
import { listDevnxProjectsForRepo } from './orca-pit-control-projects'
import {
  callerDeviceId,
  readerForViewer,
  RELOGIN_CODE,
  viewerForDevice,
  type OrcaPitControlViewer
} from './orca-pit-control-reader'
import { getDevnxTask, listDevnxTasks, type DevnxControlReader } from './orca-pit-control-tasks'
import { orcaPitMayLinkDevnxProject, type OrcaPitCallerContext } from './orca-pit-devnx-link-guard'

type CallerContext = OrcaPitCallerContext

export type OrcaPitDevnxRpcDeps = {
  session: () => OrcaPitCentralSession | null
  viewer: (context: CallerContext) => OrcaPitControlViewer
  reader: (
    viewer: OrcaPitControlViewer,
    session: OrcaPitCentralSession
  ) => DevnxControlReader | null
}

const DEFAULT_DEPS: OrcaPitDevnxRpcDeps = {
  session: () => getDevnxControlService()?.client.session() ?? null,
  viewer: (context) => viewerForDevice(callerDeviceId(context)),
  reader: (viewer, session) => readerForViewer(viewer, session)
}

const NOT_CONNECTED_MESSAGE = 'Orca não está conectado ao DevNX Control.'

export function devnxFailureCode(error: unknown): OrcaPitDevnxErrorCode {
  if (!(error instanceof DevnxControlError)) {
    return 'unavailable'
  }
  if (error.code === RELOGIN_CODE) {
    return 'relogin'
  }
  if (error.code === 'NOT_CONNECTED') {
    return 'not_connected'
  }
  return error.status === 403 ? 'forbidden' : 'unavailable'
}

export async function withCallerReader<T>(
  context: CallerContext,
  action: (reader: DevnxControlReader) => Promise<T>,
  deps: OrcaPitDevnxRpcDeps = DEFAULT_DEPS
): Promise<OrcaPitDevnxResult<T>> {
  const session = deps.session()
  const reader = session ? deps.reader(deps.viewer(context), session) : null
  if (!reader) {
    return { ok: false, code: 'not_connected', error: NOT_CONNECTED_MESSAGE }
  }
  try {
    return { ok: true, value: await action(reader) }
  } catch (error) {
    return { ok: false, code: devnxFailureCode(error), error: publicErrorMessage(error) }
  }
}

export function devnxStatusForCaller(
  context: CallerContext,
  deps: OrcaPitDevnxRpcDeps = DEFAULT_DEPS
): OrcaPitDevnxStatus {
  if (!deps.session()) {
    return ORCA_PIT_DEVNX_DISCONNECTED
  }
  const viewer = deps.viewer(context)
  return {
    connected: true,
    viewer: viewer.kind === 'relogin' ? null : viewer.kind,
    needsLogin: viewer.kind === 'relogin',
    canLink: orcaPitMayLinkDevnxProject(context)
  }
}

export const ORCA_PIT_DEVNX_RPC_METHODS = [
  defineMethod({
    name: METHODS.status,
    permission: 'workspace',
    params: null,
    handler: (_params, context): OrcaPitDevnxStatus => devnxStatusForCaller(context)
  }),
  defineMethod({
    name: METHODS.projects,
    permission: 'workspace',
    params: OrcaPitDevnxProjectsParams,
    handler: (params, context) =>
      withCallerReader(context, (reader) =>
        listDevnxProjectsForRepo(
          reader,
          params.repoId ? state.store?.getRepo(params.repoId) : null,
          {
            search: params.search
          }
        )
      )
  }),
  defineMethod({
    name: METHODS.tasks,
    permission: 'workspace',
    params: OrcaPitDevnxTasksParams,
    handler: (params, context) =>
      withCallerReader(context, (reader) => listDevnxTasks(reader, params))
  }),
  defineMethod({
    name: METHODS.task,
    permission: 'workspace',
    params: OrcaPitDevnxTaskParams,
    handler: (params, context) =>
      withCallerReader(context, (reader) => getDevnxTask(reader, params.taskId))
  })
]
