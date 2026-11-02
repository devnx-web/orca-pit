// Orca-Pit: the company's WhatsApp connector (contrato-whatsapp v1). One uazapi number per company
// lives in the DevNX Control; each group is linked to a Control project and to the machine whose
// agent answers it. The token never leaves the Control, so no type here carries it.
import type { OrcaPitDevnxResult } from './orca-pit-devnx-rpc'

export const ORCA_PIT_WHATSAPP_METHODS = {
  overview: 'orcaPit.whatsappOverview',
  connect: 'orcaPit.whatsappConnect',
  disconnect: 'orcaPit.whatsappDisconnect',
  sync: 'orcaPit.whatsappSync',
  linkRepo: 'orcaPit.whatsappLinkRepo'
} as const

export type OrcaPitWhatsappInstance = {
  connected: boolean
  status: string | null
  profileName: string | null
  ownerPhone: string | null
  baseUrl: string | null
}

export type OrcaPitWhatsappGroup = {
  id: number
  jid: string
  name: string
  topic: string | null
  imageUrl: string | null
  project: { id: number; name: string } | null
  machine: { id: number; slug: string; name: string } | null
  linkedAt: string | null
}

export type OrcaPitWhatsappOverview = {
  instance: OrcaPitWhatsappInstance | null
  groups: OrcaPitWhatsappGroup[]
  /** Admin of the company in the Control: may connect, sync and link. */
  canManage: boolean
  /** The machine that answers on this host, once approved; null otherwise. */
  machine: { id: number; name: string } | null
}

export type OrcaPitWhatsappResult = OrcaPitDevnxResult<OrcaPitWhatsappOverview>
