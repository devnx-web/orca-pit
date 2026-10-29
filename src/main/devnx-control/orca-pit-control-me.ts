// Orca-Pit: the two Control calls a browser login needs, and the central machine's own identity.
// The central asks /api/orca/me with its own session to learn which companies it serves; a person
// may only sign in when they share one of them (orca-pit-memberships).
import {
  DEVNX_CONTROL_API_PATHS as API,
  DevnxControlError,
  isRecord,
  requestDevnxControl
} from './devnx-control-http'
import type { OrcaPitUser } from './orca-pit-identity-types'
import { orcaPitUserOfMe, parseOrcaPitMe, type OrcaPitMe } from './orca-pit-memberships'

export type OrcaPitCentralSession = { baseUrl: string; token: string }

export type OrcaPitControlCalls = {
  /** E-mail and password to the user's JWT. */
  login: (baseUrl: string, email: string, password: string) => Promise<string>
  me: (baseUrl: string, token: string) => Promise<OrcaPitMe>
}

export const ORCA_PIT_CONTROL_CALLS: OrcaPitControlCalls = {
  async login(baseUrl, email, password) {
    const payload = await requestDevnxControl(baseUrl, API.login, {
      method: 'POST',
      body: { email, password }
    })
    const token = isRecord(payload) ? (payload.access_token ?? payload.token) : null
    if (typeof token !== 'string' || !token) {
      throw new DevnxControlError('Resposta de login inválida do DevNX Control.', {
        code: 'INVALID_SERVER_RESPONSE'
      })
    }
    return token
  },
  async me(baseUrl, token) {
    return parseOrcaPitMe(await requestDevnxControl(baseUrl, API.orcaMe, { token }))
  }
}

/** True for the answers that say a credential is no good, as opposed to an outage. */
export function isOrcaPitAuthRejection(error: unknown): boolean {
  return error instanceof DevnxControlError && (error.status === 401 || error.status === 403)
}

// Why 10 min: the company of a machine rarely changes, and every login would otherwise pay a call.
const CENTRAL_MAX_AGE_MS = 10 * 60_000

/** The owner of this machine's Control session, cached per token. */
export class OrcaPitCentral {
  private cached: { me: OrcaPitMe; token: string; at: number } | null = null

  constructor(
    private readonly session: () => OrcaPitCentralSession | null,
    private readonly calls: OrcaPitControlCalls = ORCA_PIT_CONTROL_CALLS,
    private readonly now: () => number = Date.now
  ) {}

  currentSession(): OrcaPitCentralSession | null {
    return this.session()
  }

  /** Last known owner for the current session, without a network call. */
  cachedUser(): OrcaPitUser | null {
    const session = this.session()
    return session && this.cached?.token === session.token ? orcaPitUserOfMe(this.cached.me) : null
  }

  /** Null without a session; throws when the panel cannot be reached and nothing is cached. */
  async me(): Promise<OrcaPitMe | null> {
    const session = this.session()
    if (!session) {
      return null
    }
    const cached = this.cached
    if (cached?.token === session.token && this.now() - cached.at < CENTRAL_MAX_AGE_MS) {
      return cached.me
    }
    try {
      const me = await this.calls.me(session.baseUrl, session.token)
      this.cached = { me, token: session.token, at: this.now() }
      return me
    } catch (error) {
      // An outage keeps the last answer for this same token; a rejected token does not.
      if (cached?.token === session.token && !isOrcaPitAuthRejection(error)) {
        return cached.me
      }
      throw error
    }
  }
}
