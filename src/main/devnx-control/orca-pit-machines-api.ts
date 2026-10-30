// Orca-Pit: the Control's machine directory routes (contrato-maquinas v1): register, heartbeat
// and the company's list. Both the person's JWT and the machine's device token are accepted there.
import type { OrcaPitMachine, OrcaPitMachineStatus } from '../../shared/orca-pit-machines'
import { DevnxControlError, isRecord, requestDevnxControl } from './devnx-control-http'

export const ORCA_PIT_MACHINE_PATHS = {
  register: '/api/orca/machines/register',
  heartbeat: (id: number): string =>
    `/api/orca/machines/${encodeURIComponent(String(id))}/heartbeat`,
  list: '/api/orca/machines'
} as const

export type OrcaPitMachineRegistration = {
  machine_uid: string
  name: string
  platform: string
  version: string
  local_port: number
  public_key: string
}

export type OrcaPitMachineReply = {
  machine: OrcaPitMachine
  tunnelToken: string | null
  /** contrato v1.2: what the router sends in X-Orca-Origin-Secret; with the tunnel token. */
  originSecret: string | null
}

export type OrcaPitMachineCalls = {
  register: (
    baseUrl: string,
    token: string,
    body: OrcaPitMachineRegistration
  ) => Promise<OrcaPitMachineReply>
  heartbeat: (
    baseUrl: string,
    token: string,
    id: number,
    body: { machine_uid: string; version: string; lan_endpoints: string[] }
  ) => Promise<OrcaPitMachineReply>
  list: (baseUrl: string, token: string) => Promise<OrcaPitMachine[]>
}

const STATUSES: readonly OrcaPitMachineStatus[] = ['pending', 'approved', 'disabled']

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function id(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

export function parseOrcaPitMachine(value: unknown): OrcaPitMachine | null {
  if (!isRecord(value)) {
    return null
  }
  const tenant = isRecord(value.tenant) ? value.tenant : {}
  const owner = isRecord(value.owner) ? value.owner : {}
  const machineId = id(value.id)
  const tenantId = id(tenant.id)
  const ownerId = id(owner.id)
  const name = text(value.name)
  const slug = text(value.slug)
  // contrato v1.1: `ws_url` is the wss address, `public_url` the https one for browsers.
  const publicUrl = text(value.ws_url)
  const status = STATUSES.find((entry) => entry === value.status)
  if (!machineId || !tenantId || !ownerId || !name || !slug || !publicUrl || !status) {
    return null
  }
  return {
    id: machineId,
    tenant: { id: tenantId, name: text(tenant.name) ?? '' },
    owner: { id: ownerId, name: text(owner.name) ?? '', avatarUrl: text(owner.avatar_url) },
    name,
    slug,
    status,
    private: value.private === true,
    platform: text(value.platform),
    version: text(value.version),
    online: value.online === true,
    lastSeenAt: text(value.last_seen_at),
    publicUrl,
    webUrl: text(value.public_url),
    lanEndpoints: Array.isArray(value.lan_endpoints)
      ? value.lan_endpoints.filter((entry): entry is string => typeof entry === 'string')
      : [],
    isMine: value.is_mine === true,
    canManage: value.can_manage === true,
    originHost: text(value.origin_host)
  }
}

function parseReply(payload: unknown): OrcaPitMachineReply {
  const machine = isRecord(payload) ? parseOrcaPitMachine(payload.machine) : null
  if (!machine) {
    throw new DevnxControlError('Resposta inválida do DevNX Control para a máquina.', {
      code: 'INVALID_SERVER_RESPONSE'
    })
  }
  const record = isRecord(payload) ? payload : {}
  return {
    machine,
    tunnelToken: text(record.tunnel_token),
    originSecret: text(record.origin_secret)
  }
}

export const ORCA_PIT_MACHINE_CALLS: OrcaPitMachineCalls = {
  async register(baseUrl, token, body) {
    return parseReply(
      await requestDevnxControl(baseUrl, ORCA_PIT_MACHINE_PATHS.register, {
        method: 'POST',
        token,
        body
      })
    )
  },
  async heartbeat(baseUrl, token, machineId, body) {
    return parseReply(
      await requestDevnxControl(baseUrl, ORCA_PIT_MACHINE_PATHS.heartbeat(machineId), {
        method: 'POST',
        token,
        body
      })
    )
  },
  async list(baseUrl, token) {
    const payload = await requestDevnxControl(baseUrl, ORCA_PIT_MACHINE_PATHS.list, { token })
    const machines = isRecord(payload) && Array.isArray(payload.machines) ? payload.machines : []
    return machines.flatMap((entry) => {
      const machine = parseOrcaPitMachine(entry)
      return machine ? [machine] : []
    })
  }
}
