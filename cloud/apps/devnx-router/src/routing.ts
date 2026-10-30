// Which machine a path under orca.devnx.com.br is for, and the path its Orca sees once the
// `/<slug>` prefix is gone. Pure, so the Worker and the local prefix test share one rule.

// Same grammar as the Control's slugs: lowercase computer name, no accents, [a-z0-9-].
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

// Top-level paths an Orca serves itself. Clients paired with `wss://orca.devnx.com.br` before
// the router (the central's own address) ask for these without a machine prefix.
const ORCA_ROOT_PATHS = new Set(['/web-index.html', '/index.html', '/orca-pit/login'])
const ORCA_ROOT_PREFIXES = ['/assets/', '/cmaps/', '/standard_fonts/', '/wasm/']
// Never machine names: the paths above, and Cloudflare's own `/cdn-cgi/`. The Control must
// refuse these as slugs too.
export const RESERVED_SLUGS = new Set(['assets', 'cmaps', 'wasm', 'orca-pit', 'cdn-cgi', 'api'])

export type RoutedPath =
  | { kind: 'root' }
  /** An Orca path without prefix: kept for clients paired with the bare domain. */
  | { kind: 'legacy-root'; originPath: string }
  | { kind: 'not-found' }
  /** `/nitro5` with no slash: a page must move to `/nitro5/` so its relative URLs keep the prefix. */
  | { kind: 'machine-bare'; slug: string }
  | { kind: 'machine'; slug: string; originPath: string }

export function routePath(pathname: string): RoutedPath {
  if (pathname === '/' || pathname === '') {
    return { kind: 'root' }
  }
  if (ORCA_ROOT_PATHS.has(pathname) || ORCA_ROOT_PREFIXES.some((p) => pathname.startsWith(p))) {
    return { kind: 'legacy-root', originPath: pathname }
  }
  const rest = pathname.slice(1)
  const slash = rest.indexOf('/')
  const first = slash === -1 ? rest : rest.slice(0, slash)
  // Paths are case-sensitive, but people type machine names however they like.
  const slug = first.toLowerCase()
  if (!SLUG.test(slug) || RESERVED_SLUGS.has(slug)) {
    return { kind: 'not-found' }
  }
  if (slash === -1) {
    return { kind: 'machine-bare', slug }
  }
  return { kind: 'machine', slug, originPath: rest.slice(slash) }
}

export function isWebSocketUpgrade(request: Request): boolean {
  return (request.headers.get('Upgrade') ?? '').toLowerCase() === 'websocket'
}
