// Orca-Pit: `POST /orca-pit/whatsapp/wake`, the router's nudge after the Control stored a message
// for one of this machine's groups. Only the router may call it (this machine's origin secret on
// the managed hostname); anyone else gets 404, as plain Orca would answer. It carries nothing: the
// bridge reads the inbox from the Control itself, so a forged or lost wake changes nothing.
import type { IncomingMessage, ServerResponse } from 'node:http'
import { checkManagedOrigin } from './orca-pit-managed-origin'
import { orcaPitWhatsappHost } from './orca-pit-whatsapp-host'

const WAKE_PATH = '/orca-pit/whatsapp/wake'

/** Also under a proxy prefix, like the login route. */
export function isOrcaPitWhatsappWakeUrl(rawUrl: string | undefined): boolean {
  if (!rawUrl) {
    return false
  }
  try {
    const { pathname } = new URL(rawUrl, 'http://127.0.0.1')
    return pathname === WAKE_PATH || pathname.endsWith(WAKE_PATH)
  } catch {
    return false
  }
}

export function handleOrcaPitWhatsappWake(
  request: IncomingMessage,
  response: ServerResponse
): void {
  const reply = (status: number): void => {
    if (!response.destroyed) {
      response.statusCode = status
      response.setHeader('Cache-Control', 'no-store')
      response.end()
    }
  }
  const host = orcaPitWhatsappHost()
  if (!host || checkManagedOrigin(request.headers) !== 'router') {
    reply(404)
    return
  }
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST')
    reply(405)
    return
  }
  // The body (if any) is ignored; drain it so the connection can be reused.
  request.resume()
  host.wake()
  reply(204)
}
