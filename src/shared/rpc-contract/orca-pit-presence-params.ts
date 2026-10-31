// Orca-Pit: the browser's "time clock" (orcaPit.presence). The browser measures its own idle time
// and tells the central Orca when the person started, stopped (and since when), came back or left.
import { z } from 'zod'

export const OrcaPitPresenceParams = z.object({
  event: z.enum(['start', 'idle', 'resume', 'end']),
  /** For `idle`: when the person stopped touching the page (epoch ms). */
  since: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional()
})

export type OrcaPitPresenceEvent = z.infer<typeof OrcaPitPresenceParams>['event']

/** Who the browser is signed in as; null for a device paired by link (no person to clock). */
export type OrcaPitPresenceResult = {
  person: { id: number; name: string; avatarUrl: string | null } | null
}
