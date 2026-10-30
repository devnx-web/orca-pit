// Orca-Pit: who is using this Orca-Pit app. On a machine paired with the DevNX Control the app
// opens on a sign-in screen; the person's Control session lives only in the main process, and
// their name and photo sign what they do here and on the servers they connect to.
import type { OrcaPitMachineListResult, OrcaPitMachineSelfState } from './orca-pit-machines'

export type OrcaPitAppPerson = {
  id: number
  name: string
  email: string
  avatarUrl: string | null
  orcaRole: 'admin' | 'member'
}

export type OrcaPitAppSessionState =
  /** This machine has no Control session: the app opens as plain Orca. */
  | { kind: 'not-required' }
  | { kind: 'signed-out'; rememberedEmail: string | null }
  /** `offline`: the Control was unreachable and the last person here was let back in. */
  | { kind: 'signed-in'; person: OrcaPitAppPerson; offline: boolean }

export type OrcaPitAppLoginFailure = 'bad-credentials' | 'wrong-tenant' | 'unavailable'

export type OrcaPitAppLoginResult =
  | { ok: true; state: OrcaPitAppSessionState }
  | { ok: false; reason: OrcaPitAppLoginFailure }

export type OrcaPitServerLoginInput = {
  address: string
  /** Omitted when the person is signed in to this app: their Control session goes instead. */
  email?: string
  password?: string
}

export type OrcaPitServerLoginFailure =
  | 'invalid-address'
  /** No session in this app and no e-mail/password given. */
  | 'needs-credentials'
  | 'unreachable'
  /** The server answers but has no Control login (plain Orca, an older Orca-Pit or unpaired). */
  | 'no-login'
  | 'bad-credentials'
  | 'wrong-tenant'
  | 'too-many'
  | 'unavailable'

export type OrcaPitServerLoginResult =
  | { ok: true; pairingUrl: string; suggestedName: string }
  | { ok: false; reason: OrcaPitServerLoginFailure; retryAfterSeconds?: number }

export type OrcaPitAppApi = {
  getSession: () => Promise<OrcaPitAppSessionState>
  login: (email: string, password: string) => Promise<OrcaPitAppLoginResult>
  logout: () => Promise<OrcaPitAppSessionState>
  /** Signs in on another Orca-Pit and returns its pairing link, for "Add server". */
  loginToServer: (input: OrcaPitServerLoginInput) => Promise<OrcaPitServerLoginResult>
  /** The address other devices reach this machine at (`wss://orca.devnx.com.br`), or null. */
  getPublicAddress: () => Promise<string | null>
  setPublicAddress: (address: string | null) => Promise<string | null>
  /** The company's machines from the DevNX Control directory. */
  listMachines: (force?: boolean) => Promise<OrcaPitMachineListResult>
  /** This machine's own directory entry and tunnel. */
  getMachineState: () => Promise<OrcaPitMachineSelfState>
}
