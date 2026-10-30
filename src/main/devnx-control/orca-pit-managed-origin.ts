// Orca-Pit: behind the orca.devnx.com.br router this machine answers on a hidden hostname of
// its own (`orca-<slug>-<hex>.devnx.com.br`), reached through its managed tunnel. The router
// proves itself with the machine's origin secret (from the Control); a request for that hostname
// without it, someone who found the hidden name, is refused before any route runs. Only with the
// secret does the router's `X-Orca-Client-IP` name the person, for the login attempt limit.
import { createHash, timingSafeEqual } from 'node:crypto'

export type OrcaPitManagedOrigin = { host: string; secret: string }

type Headers = Record<string, string | string[] | undefined>

export type ManagedOriginCheck =
  /** Not addressed to the managed hostname: a LAN client, a hand-made tunnel, this machine. */
  'other-host' | 'router' | 'refused'

const CLIENT_IP = /^[0-9a-fA-F:.]{2,45}$/

let current: { host: string; digest: Buffer } | null = null

function digest(value: string): Buffer {
  // Fixed-length digests, so the comparison takes the same time whatever the guess's length.
  return createHash('sha256').update(value, 'utf8').digest()
}

/** Set from the Control's register/heartbeat answer while the machine is approved; null stops it. */
export function setOrcaPitManagedOrigin(origin: OrcaPitManagedOrigin | null): void {
  const host = origin?.host.trim().toLowerCase() ?? ''
  current = origin && host && origin.secret ? { host, digest: digest(origin.secret) } : null
}

function requestHost(headers: Headers): string {
  const host = headers.host
  const value = (Array.isArray(host) ? host[0] : host) ?? ''
  return value.trim().toLowerCase().replace(/:\d+$/, '')
}

export function checkManagedOrigin(headers: Headers): ManagedOriginCheck {
  const origin = current
  if (!origin || requestHost(headers) !== origin.host) {
    return 'other-host'
  }
  const secret = headers['x-orca-origin-secret']
  return typeof secret === 'string' && timingSafeEqual(digest(secret), origin.digest)
    ? 'router'
    : 'refused'
}

/** The person's IP named by the router, or null when the request did not provably come through it. */
export function routedClientAddress(headers: Headers): string | null {
  const forwarded = headers['x-orca-client-ip']
  if (typeof forwarded !== 'string' || checkManagedOrigin(headers) !== 'router') {
    return null
  }
  const address = forwarded.trim()
  return CLIENT_IP.test(address) ? address : null
}
