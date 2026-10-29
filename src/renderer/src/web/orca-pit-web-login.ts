// Orca-Pit: the browser half of the DevNX Control login. The server that hands out this page
// answers `orca-pit/login` next to it (204 when the login exists); a successful login returns
// the same pairing offer a `#pairing=` link carries.

const LOGIN_PATH = 'orca-pit/login'

export type OrcaPitWebLoginResult =
  | { kind: 'ok'; pairingUrl: string }
  | { kind: 'bad-credentials' | 'wrong-tenant' | 'too-many' | 'unavailable' }

function loginUrl(location: Pick<Location, 'href'>): string {
  // Relative, so a proxy prefix in front of web-index.html is kept.
  return new URL(LOGIN_PATH, location.href).toString()
}

/** The runtime endpoint this page came from: same host, ws(s) by the page's scheme, same prefix. */
export function webClientRuntimeEndpoint(location: Pick<Location, 'href'>): string {
  const url = new URL('.', location.href)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.search = ''
  url.hash = ''
  url.pathname = url.pathname.replace(/\/$/, '') || '/'
  return url.toString()
}

export async function probeOrcaPitLogin(
  location: Pick<Location, 'href'> = window.location
): Promise<boolean> {
  try {
    const response = await fetch(loginUrl(location), { cache: 'no-store', credentials: 'omit' })
    return response.status === 204
  } catch {
    return false
  }
}

const FAILURES: Record<number, Exclude<OrcaPitWebLoginResult['kind'], 'ok'>> = {
  400: 'bad-credentials',
  401: 'bad-credentials',
  403: 'wrong-tenant',
  429: 'too-many'
}

export async function submitOrcaPitLogin(
  email: string,
  password: string,
  location: Pick<Location, 'href'> = window.location
): Promise<OrcaPitWebLoginResult> {
  let response: Response
  try {
    response = await fetch(loginUrl(location), {
      method: 'POST',
      cache: 'no-store',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, endpoint: webClientRuntimeEndpoint(location) })
    })
  } catch {
    return { kind: 'unavailable' }
  }
  if (!response.ok) {
    return { kind: FAILURES[response.status] ?? 'unavailable' }
  }
  const body = (await response.json().catch(() => null)) as { pairingUrl?: unknown } | null
  return typeof body?.pairingUrl === 'string' && body.pairingUrl
    ? { kind: 'ok', pairingUrl: body.pairingUrl }
    : { kind: 'unavailable' }
}

/** Before pairing there are no settings to pick a language from, so follow the browser. */
export function browserPrefersPortuguese(languages: readonly string[]): boolean {
  return (languages[0] ?? '').toLowerCase().startsWith('pt')
}
