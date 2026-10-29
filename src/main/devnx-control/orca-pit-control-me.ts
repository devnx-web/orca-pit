// Orca-Pit: the two Control calls a browser login needs, and the central machine's own identity.
// The central asks /api/orca/me with its own session to learn which company it serves; a person
// may only sign in to the Orca of their company.
import {
  DEVNX_CONTROL_API_PATHS as API,
  DevnxControlError,
  isRecord,
  requestDevnxControl
} from './devnx-control-http'
import type { OrcaPitUser } from './orca-pit-identity-types'
import { parseOrcaPitUser } from './orca-pit-identity'

export type OrcaPitCentralSession = { baseUrl: string; token: string }

export type OrcaPitControlCalls = {
  /** E-mail and password to the user's JWT. */
  login: (baseUrl: string, email: string, password: string) => Promise<string>
  me: (baseUrl: string, token: string) => Promise<OrcaPitUser>
}

/** `GET /api/orca/me` → `{ user, tenant, orca_role }`, flattened into an OrcaPitUser. */
export function parseOrcaPitMe(payload: unknown): OrcaPitUser {
  const user = isRecord(payload) && isRecord(payload.user) ? payload.user : null
  const tenant = isRecord(payload) && isRecord(payload.tenant) ? payload.tenant : null
  const parsed = parseOrcaPitUser({
    id: user?.id,
    name: user?.name,
    email: user?.email,
    tenantId: tenant?.id,
    orcaRole: isRecord(payload) ? payload.orca_role : null
  })
  if (!parsed) {
    throw new DevnxControlError('Resposta inválida do DevNX Control em /api/orca/me.', {
      code: 'INVALID_SERVER_RESPONSE'
    })
  }
  return parsed
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
  private cached: { user: OrcaPitUser; token: string; at: number } | null = null

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
    return session && this.cached?.token === session.token ? this.cached.user : null
  }

  /** Null without a session; throws when the panel cannot be reached and nothing is cached. */
  async user(): Promise<OrcaPitUser | null> {
    const session = this.session()
    if (!session) {
      return null
    }
    const cached = this.cached
    if (cached?.token === session.token && this.now() - cached.at < CENTRAL_MAX_AGE_MS) {
      return cached.user
    }
    try {
      const user = await this.calls.me(session.baseUrl, session.token)
      this.cached = { user, token: session.token, at: this.now() }
      return user
    } catch (error) {
      // An outage keeps the last answer for this same token; a rejected token does not.
      if (cached?.token === session.token && !isOrcaPitAuthRejection(error)) {
        return cached.user
      }
      throw error
    }
  }
}
