// Orca-Pit: the person signed in to this app (see shared/orca-pit-app-session). Their Control JWT
// stays in memory only; the disk keeps the last e-mail and, for a Control outage, a password hash
// that lets the same person back in for 12 hours, marked offline.
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type {
  OrcaPitAppLoginResult,
  OrcaPitAppPerson,
  OrcaPitAppSessionState
} from '../../shared/orca-pit-app-session'
import { DevnxControlError, isRecord } from './devnx-control-http'
import {
  isOrcaPitAuthRejection,
  ORCA_PIT_CONTROL_CALLS,
  type OrcaPitCentralSession,
  type OrcaPitControlCalls
} from './orca-pit-control-me'
import { parseOrcaPitUser } from './orca-pit-identity'
import type { OrcaPitUser } from './orca-pit-identity-types'
import { sharedOrcaPitUser, type OrcaPitMe } from './orca-pit-memberships'

// Why 12 h: a workday. Longer and a fired person keeps the machine through a Control outage.
export const ORCA_PIT_OFFLINE_GRACE_MS = 12 * 60 * 60_000

type StoredLogin = {
  email: string
  user: OrcaPitUser
  at: number
  salt: string
  hash: string
}

export type OrcaPitAppSessionDeps = {
  /** This machine's own Control session (the pairing), or null when it has none. */
  session: () => OrcaPitCentralSession | null
  /** The machine owner's memberships: a person must share a company with it. */
  centralMe: () => Promise<OrcaPitMe | null>
  filePath: string
  calls?: OrcaPitControlCalls
  now?: () => number
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 32).toString('hex')
}

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex')
  const right = Buffer.from(b, 'hex')
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right)
}

function personOf(user: OrcaPitUser): OrcaPitAppPerson {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatarUrl ?? null,
    orcaRole: user.orcaRole
  }
}

// Why: a wrong password is 401/422 on /api/login; anything else (network, 5xx) is an outage.
function isCredentialRejection(error: unknown): boolean {
  return (
    error instanceof DevnxControlError &&
    error.status !== null &&
    [400, 401, 403, 422].includes(error.status)
  )
}

export class OrcaPitAppSession {
  private signedIn: { user: OrcaPitUser; token: string | null } | null = null
  /** Set while the idle screen is up: when the person stopped touching the computer. */
  private awaySince: number | null = null
  private readonly calls: OrcaPitControlCalls
  private readonly now: () => number

  constructor(private readonly deps: OrcaPitAppSessionDeps) {
    this.calls = deps.calls ?? ORCA_PIT_CONTROL_CALLS
    this.now = deps.now ?? Date.now
  }

  state(): OrcaPitAppSessionState {
    if (!this.deps.session()) {
      return { kind: 'not-required' }
    }
    if (this.signedIn) {
      return {
        kind: 'signed-in',
        person: personOf(this.signedIn.user),
        offline: this.signedIn.token === null,
        away: this.awaySince
      }
    }
    return { kind: 'signed-out', rememberedEmail: this.readStored()?.email ?? null }
  }

  /** The person at this app, for local callers; null when nobody signed in. */
  currentUser(): OrcaPitUser | null {
    return this.deps.session() ? (this.signedIn?.user ?? null) : null
  }

  /** The person's own Control JWT; null signed out or after an offline entry. */
  controlToken(): string | null {
    return this.deps.session() ? (this.signedIn?.token ?? null) : null
  }

  logout(): OrcaPitAppSessionState {
    this.signedIn = null
    this.awaySince = null
    return this.state()
  }

  isSignedIn(): boolean {
    return this.currentUser() !== null
  }

  isAway(): boolean {
    return this.awaySince !== null
  }

  /** The idle screen comes up; `since` is when the person stopped. Ignored when nobody is in. */
  markAway(since: number): void {
    if (this.isSignedIn() && this.awaySince === null) {
      this.awaySince = since
    }
  }

  /** "Continue as <name>": the same session, no password asked. */
  resume(): OrcaPitAppSessionState {
    this.awaySince = null
    return this.state()
  }

  async login(email: string, password: string): Promise<OrcaPitAppLoginResult> {
    const session = this.deps.session()
    if (!session) {
      return { ok: true, state: { kind: 'not-required' } }
    }
    const cleanEmail = email.trim()
    if (!cleanEmail || !password) {
      return { ok: false, reason: 'bad-credentials' }
    }
    let token: string
    let me: OrcaPitMe
    let central: OrcaPitMe | null
    try {
      token = await this.calls.login(session.baseUrl, cleanEmail, password)
    } catch (error) {
      return isCredentialRejection(error)
        ? { ok: false, reason: 'bad-credentials' }
        : this.offlineLogin(cleanEmail, password)
    }
    try {
      me = await this.calls.me(session.baseUrl, token)
      central = await this.deps.centralMe()
    } catch (error) {
      if (isOrcaPitAuthRejection(error)) {
        return { ok: false, reason: 'wrong-tenant' }
      }
      return this.offlineLogin(cleanEmail, password)
    }
    const user = central ? sharedOrcaPitUser(me, central) : null
    if (!user) {
      return { ok: false, reason: 'wrong-tenant' }
    }
    this.signedIn = { user, token }
    this.awaySince = null
    this.writeStored(cleanEmail, user, password)
    return { ok: true, state: this.state() }
  }

  /** The Control is down: the last person here, with the same password, within the grace. */
  private offlineLogin(email: string, password: string): OrcaPitAppLoginResult {
    const stored = this.readStored()
    if (
      !stored ||
      stored.email.toLowerCase() !== email.toLowerCase() ||
      this.now() - stored.at > ORCA_PIT_OFFLINE_GRACE_MS ||
      !sameHash(hashPassword(password, stored.salt), stored.hash)
    ) {
      return { ok: false, reason: 'unavailable' }
    }
    this.signedIn = { user: stored.user, token: null }
    this.awaySince = null
    return { ok: true, state: this.state() }
  }

  private readStored(): StoredLogin | null {
    try {
      const value: unknown = JSON.parse(readFileSync(this.deps.filePath, 'utf8'))
      if (!isRecord(value) || typeof value.email !== 'string') {
        return null
      }
      const user = parseOrcaPitUser(value.user)
      const { at, salt, hash } = value
      return user && typeof at === 'number' && typeof salt === 'string' && typeof hash === 'string'
        ? { email: value.email, user, at, salt, hash }
        : null
    } catch {
      return null
    }
  }

  private writeStored(email: string, user: OrcaPitUser, password: string): void {
    const salt = randomBytes(16).toString('hex')
    const stored: StoredLogin = {
      email,
      user,
      at: this.now(),
      salt,
      hash: hashPassword(password, salt)
    }
    try {
      mkdirSync(dirname(this.deps.filePath), { recursive: true })
      writeFileSync(this.deps.filePath, `${JSON.stringify(stored)}\n`, { mode: 0o600 })
    } catch (error) {
      // Only the remembered e-mail and the offline entry are lost; the sign-in itself stands.
      console.warn('[orca-pit] could not remember the app login:', (error as Error).message)
    }
  }
}
