// Resolves a machine slug through the Control's router endpoint, cached at the edge so a
// terminal reconnect storm does not become a storm of Control requests.
import type { RouterDeps, RouterEnv } from './env'

export type MachineLookup =
  /** `originSecret` goes to the machine on every request; it refuses its hidden host without it. */
  | { kind: 'found'; originHost: string; originSecret: string; online: boolean }
  /** Exists in the Control but cannot take traffic yet (awaiting approval, or disabled). */
  | { kind: 'blocked'; status: 'pending' | 'disabled' | 'unknown' }
  | { kind: 'missing' }
  /** The Control did not answer; nothing is cached so the next request asks again. */
  | { kind: 'unavailable' }

// Why 60 s: approval, rename and removal reach the edge within a minute, as the contract says.
const FOUND_TTL_SECONDS = 60
// Why shorter: a machine approved right after someone typed its name should not stay "missing".
const MISSING_TTL_SECONDS = 15
const CACHE_ORIGIN = 'https://orca-router.cache'
// The Control sits behind Cloudflare's browser check, which refuses requests without a UA.
const USER_AGENT = 'orca-devnx-router/1'
// One label under the zone (`orca-<slug>-<6 hex>`): the free universal certificate covers only
// `*.devnx.com.br`. Anything else is not a managed tunnel, whatever the Control says.
const ORIGIN_HOST = /^orca-[a-z0-9-]+-[a-z0-9]{6}\.devnx\.com\.br$/

type CachedEntry = { status: number; body: unknown }

function cacheKey(slug: string): Request {
  return new Request(`${CACHE_ORIGIN}/machines/${slug}`)
}

export function parseRouterAnswer(status: number, body: unknown): MachineLookup {
  if (status === 404) {
    return { kind: 'missing' }
  }
  if (status !== 200 || typeof body !== 'object' || body === null) {
    return { kind: 'unavailable' }
  }
  const record = body as Record<string, unknown>
  const machineStatus = record.status
  const originHost = typeof record.origin_host === 'string' ? record.origin_host : null
  const originSecret = typeof record.origin_secret === 'string' ? record.origin_secret : ''
  if (machineStatus === 'approved' && originHost && ORIGIN_HOST.test(originHost) && originSecret) {
    return { kind: 'found', originHost, originSecret, online: record.online !== false }
  }
  // The contract sends only approved machines; a newer Control may also describe the others.
  return {
    kind: 'blocked',
    status: machineStatus === 'pending' || machineStatus === 'disabled' ? machineStatus : 'unknown'
  }
}

export async function lookupMachine(
  slug: string,
  env: RouterEnv,
  deps: RouterDeps,
  waitUntil: (promise: Promise<unknown>) => void
): Promise<MachineLookup> {
  const key = cacheKey(slug)
  const cached = await deps.cache.match(key)
  if (cached) {
    const entry = (await cached.json()) as CachedEntry
    return parseRouterAnswer(entry.status, entry.body)
  }
  let response: Response
  try {
    response = await deps.fetch(
      `${env.CONTROL_BASE_URL.replace(/\/$/, '')}/api/orca/router/machines/${slug}`,
      {
        headers: {
          Accept: 'application/json',
          'User-Agent': USER_AGENT,
          'X-Orca-Router-Key': env.ORCA_ROUTER_KEY
        }
      }
    )
  } catch {
    return { kind: 'unavailable' }
  }
  const body: unknown = response.status === 200 ? await response.json().catch(() => null) : null
  const lookup = parseRouterAnswer(response.status, body)
  if (lookup.kind !== 'unavailable') {
    const ttl = lookup.kind === 'missing' ? MISSING_TTL_SECONDS : FOUND_TTL_SECONDS
    const entry: CachedEntry = { status: response.status, body }
    waitUntil(
      deps.cache.put(
        key,
        new Response(JSON.stringify(entry), {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${ttl}` }
        })
      )
    )
  }
  return lookup
}
