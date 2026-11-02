// Orca-Pit: params of the WhatsApp connector calls (orcaPit.whatsapp*). The token is only ever
// sent to the Control; the host neither stores nor echoes it.
import { z } from 'zod'

const ControlId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER)

export const OrcaPitWhatsappConnectParams = z.object({
  baseUrl: z.string().trim().min(1).max(255),
  token: z.string().trim().min(1).max(255)
})

export const OrcaPitWhatsappLinkRepoParams = z.object({
  repoId: z.string().min(1).max(1024),
  /** null unlinks the group this project has on this machine. */
  groupId: ControlId.nullable()
})
