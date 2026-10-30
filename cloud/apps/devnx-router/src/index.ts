// Orca-Pit: orca.devnx.com.br/<machine> → that machine's hidden tunnel. The Worker picks the
// machine and strips the prefix; HTTP and WebSocket pass through untouched, and the Orca still
// encrypts its traffic end to end with the key pinned at pairing, so the router reads nothing.
import type { ExecutionContextLike, RouterCache, RouterDeps, RouterEnv } from './env'
import { lookupMachine, type MachineLookup } from './machines'
import {
  blockedMachinePage,
  controlUnavailablePage,
  machinePickerPage,
  missingMachinePage,
  offlineMachinePage
} from './pages'
import { isWebSocketUpgrade, routePath } from './routing'

// Decision 5 (30/10/2026): the bare domain keeps opening the central for a month, so bookmarks
// survive the move; after that it becomes the machine picker.
export const ROOT_REDIRECT_UNTIL_MS = Date.parse('2026-11-30T23:59:59-03:00')
export const DEFAULT_MACHINE = 'ftgknote'

// The hand-made tunnels of before the router, used only while a machine has no managed tunnel
// yet (phase 5 moves both). Same date as the root redirect: after it, the Control is the truth.
const LEGACY_ORIGINS: Readonly<Record<string, string>> = {
  ftgknote: 'orca.devnx.com.br',
  nitro5: 'nitro5.devnx.com.br'
}

// Statuses Cloudflare answers when the tunnel behind a hostname is down.
const TUNNEL_DOWN = new Set([502, 503, 504, 530])

/** `secret` is set for a managed tunnel; the hand-made ones of before the router have none. */
type Target = { host: string; secret: string | null }

function legacyTarget(slug: string, now: number): Target | null {
  const host = now <= ROOT_REDIRECT_UNTIL_MS ? LEGACY_ORIGINS[slug] : undefined
  return host ? { host, secret: null } : null
}

function redirect(location: string, status = 302): Response {
  return new Response(null, { status, headers: { Location: location, 'Cache-Control': 'no-store' } })
}

function wantsPage(request: Request): boolean {
  return (
    (request.method === 'GET' || request.method === 'HEAD') &&
    !isWebSocketUpgrade(request) &&
    (request.headers.get('Accept') ?? '').includes('text/html')
  )
}

/** The request the machine's Orca receives: same method, body and headers, prefix removed. */
export function originRequest(
  request: Request,
  target: Target,
  originPath: string,
  slug: string
): Request {
  const incoming = new URL(request.url)
  const headers = new Headers(request.headers)
  // A client must not choose its own IP nor carry a secret of its own to the machine.
  for (const name of [...headers.keys()]) {
    if (name === 'x-orca-client-ip' || name === 'x-orca-origin-secret') {
      headers.delete(name)
    }
  }
  headers.set('X-Orca-Client-IP', request.headers.get('CF-Connecting-IP') ?? '')
  headers.set('X-Forwarded-Host', incoming.host)
  headers.set('X-Forwarded-Proto', 'https')
  headers.set('X-Forwarded-Prefix', `/${slug}`)
  if (target.secret) {
    headers.set('X-Orca-Origin-Secret', target.secret)
  }
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
  return new Request(`https://${target.host}${originPath}${incoming.search}`, {
    method: request.method,
    headers,
    body: hasBody ? request.body : null,
    redirect: 'manual',
    // Node's fetch (tests) needs this to stream a body; Workers ignore it.
    ...(hasBody ? { duplex: 'half' } : {})
  } as RequestInit)
}

async function forward(
  request: Request,
  target: Target,
  originPath: string,
  slug: string,
  deps: RouterDeps
): Promise<Response> {
  const page = wantsPage(request)
  let response: Response
  try {
    response = await deps.fetch(originRequest(request, target, originPath, slug))
  } catch {
    return page ? offlineMachinePage(slug) : new Response(null, { status: 502 })
  }
  // A WebSocket answer is handed back as is: the platform joins the two sockets and the
  // Worker never sees a frame (nor pays for one).
  if (page && TUNNEL_DOWN.has(response.status)) {
    return offlineMachinePage(slug)
  }
  return response
}

function targetFor(lookup: MachineLookup, slug: string, now: number): Target | Response {
  if (lookup.kind === 'found') {
    return { host: lookup.originHost, secret: lookup.originSecret }
  }
  if (lookup.kind === 'blocked') {
    return blockedMachinePage(slug, lookup.status)
  }
  const legacy = legacyTarget(slug, now)
  if (legacy) {
    return legacy
  }
  return lookup.kind === 'missing' ? missingMachinePage(slug) : controlUnavailablePage()
}

export async function handleRequest(
  request: Request,
  env: RouterEnv,
  ctx: ExecutionContextLike,
  deps: RouterDeps
): Promise<Response> {
  const url = new URL(request.url)
  const route = routePath(url.pathname)
  const now = deps.now()
  if (route.kind === 'root') {
    if (isWebSocketUpgrade(request)) {
      // A desktop or phone paired with `wss://orca.devnx.com.br` before the router.
      return routeMachine(request, DEFAULT_MACHINE, '/', env, ctx, deps)
    }
    const picked = (url.searchParams.get('maquina') ?? '').trim().toLowerCase()
    if (picked) {
      const target = routePath(`/${picked}/`)
      return target.kind === 'machine' ? redirect(`/${target.slug}/`) : missingMachinePage(picked)
    }
    return now <= ROOT_REDIRECT_UNTIL_MS ? redirect(`/${DEFAULT_MACHINE}/`) : machinePickerPage()
  }
  if (route.kind === 'legacy-root') {
    return routeMachine(request, DEFAULT_MACHINE, route.originPath, env, ctx, deps)
  }
  if (route.kind === 'not-found') {
    return wantsPage(request) ? missingMachinePage(url.pathname.slice(1, 64)) : new Response(null, { status: 404 })
  }
  if (route.kind === 'machine-bare' && !isWebSocketUpgrade(request)) {
    // Relative asset and login URLs need the trailing slash to keep the prefix.
    return redirect(`/${route.slug}/${url.search}`, 301)
  }
  const originPath = route.kind === 'machine' ? route.originPath : '/'
  return routeMachine(request, route.slug, originPath, env, ctx, deps)
}

async function routeMachine(
  request: Request,
  slug: string,
  originPath: string,
  env: RouterEnv,
  ctx: ExecutionContextLike,
  deps: RouterDeps
): Promise<Response> {
  const lookup = await lookupMachine(slug, env, deps, (promise) => ctx.waitUntil(promise))
  const target = targetFor(lookup, slug, deps.now())
  if (target instanceof Response) {
    return wantsPage(request) || request.method === 'GET'
      ? target
      : new Response(null, { status: target.status })
  }
  return forward(request, target, originPath, slug, deps)
}

export default {
  fetch(request: Request, env: RouterEnv, ctx: ExecutionContextLike): Promise<Response> {
    const cache = (globalThis as unknown as { caches: { default: RouterCache } }).caches.default
    return handleRequest(request, env, ctx, { fetch: (input, init) => fetch(input, init), cache, now: Date.now })
  }
}
