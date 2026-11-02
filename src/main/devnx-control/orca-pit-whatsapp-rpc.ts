// Orca-Pit: the WhatsApp screens over the runtime RPC. The host that owns the Orca project answers,
// so the group is linked to the machine where its chat will run. The Control is called with the
// caller's own login (a paired person's JWT, else this app's person, else the central session);
// the Control decides who is an admin. Results use the same shape as the DevNX Control reads.
import { defineMethod, type RpcContext } from '../runtime/rpc/core'
import type { OrcaPitDevnxErrorCode } from '../../shared/orca-pit-devnx-rpc'
import {
  ORCA_PIT_WHATSAPP_METHODS as METHODS,
  type OrcaPitWhatsappOverview,
  type OrcaPitWhatsappResult
} from '../../shared/orca-pit-whatsapp'
import {
  OrcaPitWhatsappConnectParams,
  OrcaPitWhatsappLinkRepoParams
} from '../../shared/rpc-contract/orca-pit-whatsapp-params'
import { mainProcessState as state } from '../startup/main-process-state'
import { DevnxControlError, publicErrorMessage } from './devnx-control-http'
import { getDevnxControlService } from './devnx-control-service'
import { callerDeviceId, reloginError, viewerForDevice } from './orca-pit-control-reader'
import { devnxFailureCode } from './orca-pit-devnx-rpc'
import { orcaPitMayLinkDevnxProject } from './orca-pit-devnx-link-guard'
import {
  whatsappControlMessage,
  whatsappPersonCalls,
  type OrcaPitWhatsappPersonCalls
} from './orca-pit-whatsapp-api'
import { orcaPitWhatsappHost } from './orca-pit-whatsapp-host'

type CallerContext = Pick<RpcContext, 'caller' | 'pairedDeviceId'>

class WhatsappRefusal extends Error {
  constructor(
    readonly code: OrcaPitDevnxErrorCode,
    message: string
  ) {
    super(message)
  }
}

function callsFor(context: CallerContext): OrcaPitWhatsappPersonCalls {
  const session = getDevnxControlService()?.client.session() ?? null
  if (!session) {
    throw new WhatsappRefusal('not_connected', 'Orca não está conectado ao DevNX Control.')
  }
  const deviceId = callerDeviceId(context)
  const viewer = viewerForDevice(deviceId)
  if (viewer.kind === 'relogin') {
    throw reloginError()
  }
  const token =
    viewer.kind === 'user'
      ? viewer.token
      : ((deviceId ? null : (orcaPitWhatsappHost()?.personToken() ?? null)) ?? session.token)
  return whatsappPersonCalls(session.baseUrl, token)
}

function approvedMachine(): { id: number; name: string } | null {
  return orcaPitWhatsappHost()?.approvedMachine() ?? null
}

async function overviewOf(calls: OrcaPitWhatsappPersonCalls): Promise<OrcaPitWhatsappOverview> {
  return { ...(await calls.overview()), machine: approvedMachine() }
}

async function answer(
  context: CallerContext,
  action: (calls: OrcaPitWhatsappPersonCalls) => Promise<OrcaPitWhatsappOverview>
): Promise<OrcaPitWhatsappResult> {
  try {
    return { ok: true, value: await action(callsFor(context)) }
  } catch (error) {
    if (error instanceof WhatsappRefusal) {
      return { ok: false, code: error.code, error: error.message }
    }
    const fromControl =
      error instanceof DevnxControlError && error.status === 422
        ? whatsappControlMessage(error)
        : null
    return {
      ok: false,
      code: devnxFailureCode(error),
      error: fromControl ?? publicErrorMessage(error)
    }
  }
}

/** Links the chosen group to this project and this machine, and frees the one it had here. */
async function linkRepo(
  calls: OrcaPitWhatsappPersonCalls,
  repoId: string,
  groupId: number | null
): Promise<OrcaPitWhatsappOverview> {
  const repo = state.store?.getRepo(repoId)
  const projectId = repo?.devnxControlProject?.id ?? null
  const machine = approvedMachine()
  const host = orcaPitWhatsappHost()
  if (!host) {
    throw new WhatsappRefusal('unavailable', 'Este Orca não atende grupos do WhatsApp.')
  }
  if (!repo) {
    throw new WhatsappRefusal('unavailable', 'Projeto não encontrado nesta máquina.')
  }
  if (groupId !== null && projectId === null) {
    throw new WhatsappRefusal(
      'unavailable',
      'Vincule este projeto a um projeto do DevNX Control antes de escolher o grupo.'
    )
  }
  if (groupId !== null && !machine) {
    throw new WhatsappRefusal(
      'unavailable',
      'Esta máquina ainda não foi aprovada em Máquinas da empresa.'
    )
  }
  const bridge = host.state
  const company = await calls.overview()
  const previous = company.groups.filter(
    (group) =>
      group.id !== groupId &&
      projectId !== null &&
      group.project?.id === projectId &&
      machine !== null &&
      group.machine?.id === machine.id &&
      (bridge.group(group.id).repoId ?? repoId) === repoId
  )
  for (const group of previous) {
    await calls.linkGroup(group.id, { project_id: null, orca_machine_id: null })
    bridge.updateGroup(group.id, ({ repoId: _freed, ...rest }) => rest)
  }
  if (groupId !== null && machine) {
    await calls.linkGroup(groupId, { project_id: projectId, orca_machine_id: machine.id })
    bridge.updateGroup(groupId, (group) => ({ ...group, repoId }))
    host.wake()
  }
  return overviewOf(calls)
}

export const ORCA_PIT_WHATSAPP_RPC_METHODS = [
  defineMethod({
    name: METHODS.overview,
    permission: 'workspace',
    params: null,
    handler: (_params, context) => answer(context, overviewOf)
  }),
  defineMethod({
    name: METHODS.connect,
    permission: 'workspace',
    params: OrcaPitWhatsappConnectParams,
    handler: (params, context) =>
      answer(context, async (calls) => ({
        ...(await calls.connect(params.baseUrl, params.token)),
        machine: approvedMachine()
      }))
  }),
  defineMethod({
    name: METHODS.disconnect,
    permission: 'workspace',
    params: null,
    handler: (_params, context) =>
      answer(context, async (calls) => {
        await calls.disconnect()
        return overviewOf(calls)
      })
  }),
  defineMethod({
    name: METHODS.sync,
    permission: 'workspace',
    params: null,
    handler: (_params, context) =>
      answer(context, async (calls) => {
        await calls.sync()
        return overviewOf(calls)
      })
  }),
  defineMethod({
    name: METHODS.linkRepo,
    permission: 'workspace',
    params: OrcaPitWhatsappLinkRepoParams,
    handler: (params, context) =>
      answer(context, (calls) => {
        if (!orcaPitMayLinkDevnxProject(context)) {
          throw new WhatsappRefusal(
            'forbidden',
            'Só um administrador da empresa no DevNX Control escolhe o grupo do projeto.'
          )
        }
        return linkRepo(calls, params.repoId, params.groupId)
      })
  })
]
