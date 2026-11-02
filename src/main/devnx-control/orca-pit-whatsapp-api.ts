// Orca-Pit: the Control's WhatsApp routes (contrato-whatsapp v1). The screens call them with the
// person's login (admins change, members read); the bridge calls the inbox and send routes as this
// machine, named by its install uid in X-Orca-Machine-Uid, as the heartbeat does.
import type {
  OrcaPitWhatsappGroup,
  OrcaPitWhatsappInstance,
  OrcaPitWhatsappOverview
} from '../../shared/orca-pit-whatsapp'
import { DevnxControlError, isRecord, requestDevnxControl } from './devnx-control-http'

export const ORCA_PIT_WHATSAPP_PATHS = {
  overview: '/api/orca/whatsapp',
  instance: '/api/orca/whatsapp/instance',
  sync: '/api/orca/whatsapp/groups/sync',
  groups: '/api/orca/whatsapp/groups',
  group: (id: number): string => `/api/orca/whatsapp/groups/${encodeURIComponent(String(id))}`,
  send: (id: number): string => `/api/orca/whatsapp/groups/${encodeURIComponent(String(id))}/send`,
  inbox: '/api/orca/whatsapp/inbox',
  ack: '/api/orca/whatsapp/inbox/ack'
} as const

export type OrcaPitWhatsappInboxMessage = {
  id: number
  group: { id: number; jid: string; name: string; projectId: number | null }
  sender: { name: string | null; phone: string | null; userId: number | null; fromTeam: boolean }
  mentionsOrca: boolean
  text: string | null
  messageType: string | null
  fileUrl: string | null
  quotedId: string | null
  /** ISO 8601, as the Control stored it; null when the payload had no time. */
  sentAt: string | null
}

/** What the bridge needs from the Control, as this machine. */
export type OrcaPitWhatsappMachineCalls = {
  inbox: () => Promise<OrcaPitWhatsappInboxMessage[]>
  ack: (ids: number[]) => Promise<void>
  send: (groupId: number, text: string) => Promise<void>
}

/** The overview without this host's machine, which the caller adds. */
export type OrcaPitWhatsappCompany = Omit<OrcaPitWhatsappOverview, 'machine'>

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function id(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null
}

function parseInstance(value: unknown): OrcaPitWhatsappInstance | null {
  if (!isRecord(value)) {
    return null
  }
  return {
    connected: value.connected === true,
    status: text(value.status),
    profileName: text(value.profile_name),
    ownerPhone: text(value.owner_phone),
    baseUrl: text(value.base_url)
  }
}

export function parseWhatsappGroup(value: unknown): OrcaPitWhatsappGroup | null {
  if (!isRecord(value)) {
    return null
  }
  const groupId = id(value.id)
  const jid = text(value.jid)
  if (!groupId || !jid) {
    return null
  }
  const project = isRecord(value.project) ? value.project : null
  const machine = isRecord(value.machine) ? value.machine : null
  const projectId = project ? id(project.id) : null
  const machineId = machine ? id(machine.id) : null
  return {
    id: groupId,
    jid,
    name: text(value.name) ?? jid,
    topic: text(value.topic),
    imageUrl: text(value.image_url),
    project: project && projectId ? { id: projectId, name: text(project.name) ?? '' } : null,
    machine:
      machine && machineId
        ? { id: machineId, slug: text(machine.slug) ?? '', name: text(machine.name) ?? '' }
        : null,
    linkedAt: text(value.linked_at)
  }
}

function parseGroups(value: unknown): OrcaPitWhatsappGroup[] {
  return (Array.isArray(value) ? value : []).flatMap((entry) => {
    const group = parseWhatsappGroup(entry)
    return group ? [group] : []
  })
}

export function parseWhatsappCompany(payload: unknown): OrcaPitWhatsappCompany {
  const record = isRecord(payload) ? payload : {}
  return {
    instance: parseInstance(record.instance),
    groups: parseGroups(record.groups),
    canManage: record.can_manage === true
  }
}

export function parseWhatsappInbox(payload: unknown): OrcaPitWhatsappInboxMessage[] {
  const messages = isRecord(payload) && Array.isArray(payload.messages) ? payload.messages : []
  return messages.flatMap((entry): OrcaPitWhatsappInboxMessage[] => {
    if (!isRecord(entry) || !isRecord(entry.group)) {
      return []
    }
    const messageId = id(entry.id)
    const groupId = id(entry.group.id)
    const jid = text(entry.group.jid)
    if (!messageId || !groupId || !jid) {
      return []
    }
    const sender = isRecord(entry.sender) ? entry.sender : {}
    return [
      {
        id: messageId,
        group: {
          id: groupId,
          jid,
          name: text(entry.group.name) ?? jid,
          projectId: id(entry.group.project_id)
        },
        sender: {
          name: text(sender.name),
          phone: text(sender.phone),
          userId: id(sender.user_id),
          fromTeam: sender.from_team === true
        },
        mentionsOrca: entry.mentions_orca === true,
        text: typeof entry.text === 'string' ? entry.text : null,
        messageType: text(entry.message_type),
        fileUrl: text(entry.file_url),
        quotedId: text(entry.quoted_id),
        sentAt: text(entry.sent_at)
      }
    ]
  })
}

/** The Control's own sentence ("Token inválido…"), without the transport prefix. */
export function whatsappControlMessage(error: unknown): string | null {
  if (!(error instanceof DevnxControlError)) {
    return null
  }
  return error.message.replace(/^DevNX Control respondeu HTTP \d+:\s*/, '') || null
}

export type OrcaPitWhatsappPersonCalls = {
  overview: () => Promise<OrcaPitWhatsappCompany>
  connect: (baseUrl: string, token: string) => Promise<OrcaPitWhatsappCompany>
  disconnect: () => Promise<void>
  sync: () => Promise<void>
  linkGroup: (
    groupId: number,
    link: { project_id: number | null; orca_machine_id: number | null }
  ) => Promise<void>
}

export function whatsappPersonCalls(baseUrl: string, token: string): OrcaPitWhatsappPersonCalls {
  const call = (
    path: string,
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
    body?: unknown
  ): Promise<unknown> => requestDevnxControl(baseUrl, path, { method, token, body })
  return {
    overview: async () => parseWhatsappCompany(await call(ORCA_PIT_WHATSAPP_PATHS.overview)),
    connect: async (url, instanceToken) =>
      parseWhatsappCompany(
        await call(ORCA_PIT_WHATSAPP_PATHS.instance, 'PUT', {
          base_url: url,
          token: instanceToken
        })
      ),
    disconnect: async () => {
      await call(ORCA_PIT_WHATSAPP_PATHS.instance, 'DELETE')
    },
    // Why a POST with no body: the Control pages /group/list itself.
    sync: async () => {
      await call(ORCA_PIT_WHATSAPP_PATHS.sync, 'POST', {})
    },
    linkGroup: async (groupId, link) => {
      await call(ORCA_PIT_WHATSAPP_PATHS.group(groupId), 'PUT', link)
    }
  }
}

/** The person's JWT first, then the machine's device token when it expired, as the heartbeat. */
export function whatsappMachineCalls(
  baseUrl: string,
  tokens: () => string[],
  machineUid: string
): OrcaPitWhatsappMachineCalls {
  const call = async (path: string, body?: unknown): Promise<unknown> => {
    let lastError: unknown = new DevnxControlError('Sem credencial do DevNX Control.')
    for (const token of tokens()) {
      try {
        return await requestDevnxControl(baseUrl, path, {
          method: body === undefined ? 'GET' : 'POST',
          token,
          body,
          headers: { 'X-Orca-Machine-Uid': machineUid }
        })
      } catch (error) {
        lastError = error
        if (!(error instanceof DevnxControlError) || error.status !== 401) {
          throw error
        }
      }
    }
    throw lastError
  }
  return {
    inbox: async () => parseWhatsappInbox(await call(ORCA_PIT_WHATSAPP_PATHS.inbox)),
    ack: async (ids) => {
      await call(ORCA_PIT_WHATSAPP_PATHS.ack, { ids })
    },
    send: async (groupId, message) => {
      await call(ORCA_PIT_WHATSAPP_PATHS.send(groupId), { text: message })
    }
  }
}
