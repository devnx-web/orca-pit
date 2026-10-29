// Orca-Pit: the browser login on the central machine. A person signs in with their DevNX Control
// e-mail and password; the central checks the company, mints a runtime row for that person and
// answers with the same pairing offer a `#pairing=` link carries, so the web client goes on as
// if it had been handed a link.
import { DevnxControlError, publicErrorMessage } from './devnx-control-http'
import {
  isOrcaPitAuthRejection,
  ORCA_PIT_CONTROL_CALLS,
  type OrcaPitCentral,
  type OrcaPitControlCalls
} from './orca-pit-control-me'
import type { OrcaPitDeviceIdentity } from './orca-pit-identity'
import type { OrcaPitUser } from './orca-pit-identity-types'

export type OrcaPitLoginInput = { email: string; password: string; endpoint: string | null }

export type OrcaPitLoginOutcome =
  | { kind: 'ok'; pairingUrl: string; user: OrcaPitUser }
  | { kind: 'bad-credentials' }
  | { kind: 'wrong-tenant' }
  /** This machine has no Control session: the login does not exist. */
  | { kind: 'inactive' }
  | { kind: 'unavailable' }

export type OrcaPitLoginDeps = {
  central: OrcaPitCentral
  calls?: OrcaPitControlCalls
  /** Mints the person's runtime row and its pairing offer; null when pairing is unavailable. */
  createOffer: (identity: OrcaPitDeviceIdentity, endpoint: string | null) => string | null
}

// Why: the panel answers a wrong password with 401 or a validation 422, depending on the route.
function isCredentialRejection(error: unknown): boolean {
  return (
    error instanceof DevnxControlError &&
    error.status !== null &&
    [400, 401, 403, 422].includes(error.status)
  )
}

function unavailable(step: string, error: unknown): OrcaPitLoginOutcome {
  console.warn(`[orca-pit] login: ${step} failed:`, publicErrorMessage(error))
  return { kind: 'unavailable' }
}

export async function performOrcaPitLogin(
  deps: OrcaPitLoginDeps,
  input: OrcaPitLoginInput
): Promise<OrcaPitLoginOutcome> {
  const calls = deps.calls ?? ORCA_PIT_CONTROL_CALLS
  const session = deps.central.currentSession()
  if (!session) {
    return { kind: 'inactive' }
  }
  let central: OrcaPitUser | null
  try {
    central = await deps.central.user()
  } catch (error) {
    return unavailable('central /api/orca/me', error)
  }
  if (!central) {
    return { kind: 'inactive' }
  }

  let controlToken: string
  try {
    controlToken = await calls.login(session.baseUrl, input.email, input.password)
  } catch (error) {
    return isCredentialRejection(error)
      ? { kind: 'bad-credentials' }
      : unavailable('/api/login', error)
  }

  let user: OrcaPitUser
  try {
    user = await calls.me(session.baseUrl, controlToken)
  } catch (error) {
    if (isOrcaPitAuthRejection(error)) {
      // 403 is the tenant middleware: a valid person without a company here.
      return error instanceof DevnxControlError && error.status === 403
        ? { kind: 'wrong-tenant' }
        : { kind: 'bad-credentials' }
    }
    return unavailable('/api/orca/me', error)
  }
  if (user.tenantId !== central.tenantId) {
    return { kind: 'wrong-tenant' }
  }

  let pairingUrl: string | null
  try {
    pairingUrl = deps.createOffer({ user, controlToken }, input.endpoint)
  } catch (error) {
    return unavailable('pairing offer', error)
  }
  if (!pairingUrl) {
    return { kind: 'unavailable' }
  }
  console.info(`[orca-pit] browser login for Control user #${user.id} (${user.orcaRole})`)
  return { kind: 'ok', pairingUrl, user }
}
