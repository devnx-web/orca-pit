// Orca-Pit: the WhatsApp connector calls, through the runtime RPC of the host that answers (this
// app for the company page, the project's owner for the project's group). Transport failures come
// back as results, like the DevNX Control reads.
import { parseOrcaPitDevnxResult } from '../../../shared/orca-pit-devnx-rpc'
import type { RuntimeClientTarget } from '../../../shared/runtime-client-target'
import {
  ORCA_PIT_WHATSAPP_METHODS as METHODS,
  type OrcaPitWhatsappOverview,
  type OrcaPitWhatsappResult
} from '../../../shared/orca-pit-whatsapp'
import { callRuntimeRpc } from './runtime-rpc-client'

// Why 60 s: Connect and Sync wait on the uazapi through the Control.
const TIMEOUT_MS = 60_000

async function call(
  target: RuntimeClientTarget,
  method: string,
  params?: unknown
): Promise<OrcaPitWhatsappResult> {
  try {
    const raw = await callRuntimeRpc<unknown>(target, method, params, { timeoutMs: TIMEOUT_MS })
    return parseOrcaPitDevnxResult<OrcaPitWhatsappOverview>(raw)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // An Orca host without this feature has no such method: same as not connected.
    return /method[_ ]not[_ ]found|unknown method/i.test(message)
      ? { ok: false, code: 'not_connected', error: message }
      : { ok: false, code: 'unavailable', error: message }
  }
}

export const orcaPitWhatsapp = {
  overview: (target: RuntimeClientTarget) => call(target, METHODS.overview),
  connect: (target: RuntimeClientTarget, input: { baseUrl: string; token: string }) =>
    call(target, METHODS.connect, input),
  disconnect: (target: RuntimeClientTarget) => call(target, METHODS.disconnect),
  sync: (target: RuntimeClientTarget) => call(target, METHODS.sync),
  linkRepo: (target: RuntimeClientTarget, input: { repoId: string; groupId: number | null }) =>
    call(target, METHODS.linkRepo, input)
}
