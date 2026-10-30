// Orca-Pit: a browser login lasts while the person is still a user of this machine's company.
// On startup and every 10 minutes the central asks /api/orca/me with each person's JWT; a
// rejected token or no company shared with the central's owner revokes the rows through the normal revoke path, which
// also closes their sockets. An outage revokes nothing.
import { publicErrorMessage } from './devnx-control-http'
import {
  isOrcaPitAuthRejection,
  ORCA_PIT_CONTROL_CALLS,
  type OrcaPitCentral,
  type OrcaPitControlCalls
} from './orca-pit-control-me'
import type { DeviceEntry } from '../runtime/device-entry'
import type { OrcaPitUser } from './orca-pit-identity-types'
import { sharedOrcaPitUser, type OrcaPitMe } from './orca-pit-memberships'

const REVALIDATE_EVERY_MS = 10 * 60_000
// Why a delay: the Control session is loaded after the runtime server starts.
const FIRST_RUN_DELAY_MS = 15_000

export type OrcaPitRevalidationDeps = {
  central: OrcaPitCentral
  listDevices: () => readonly DeviceEntry[]
  revoke: (deviceId: string) => boolean
  updateUser: (deviceId: string, user: OrcaPitUser) => boolean
  calls?: OrcaPitControlCalls
}

export type OrcaPitRevalidationReport = { checked: number; revoked: string[]; updated: string[] }

function sameUser(a: OrcaPitUser, b: OrcaPitUser): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.email === b.email &&
    a.tenantId === b.tenantId &&
    a.tenantIds.join() === b.tenantIds.join() &&
    a.orcaRole === b.orcaRole &&
    // A new profile photo reaches the sidebar on the next check.
    (a.avatarUrl ?? null) === (b.avatarUrl ?? null)
  )
}

/** One pass. Rows sharing a JWT (a token row and its device-key forks) cost a single call. */
export async function revalidateOrcaPitDevices(
  deps: OrcaPitRevalidationDeps
): Promise<OrcaPitRevalidationReport> {
  const report: OrcaPitRevalidationReport = { checked: 0, revoked: [], updated: [] }
  const session = deps.central.currentSession()
  if (!session) {
    return report
  }
  let central: OrcaPitMe | null
  try {
    central = await deps.central.me()
  } catch (error) {
    console.warn('[orca-pit] revalidation skipped:', publicErrorMessage(error))
    return report
  }
  if (!central) {
    return report
  }
  const byToken = new Map<string, DeviceEntry[]>()
  for (const device of deps.listDevices()) {
    if (device.orcaPitControlToken) {
      byToken.set(device.orcaPitControlToken, [
        ...(byToken.get(device.orcaPitControlToken) ?? []),
        device
      ])
    }
  }
  const calls = deps.calls ?? ORCA_PIT_CONTROL_CALLS
  for (const [token, devices] of byToken) {
    report.checked += 1
    let me: OrcaPitMe
    try {
      me = await calls.me(session.baseUrl, token)
    } catch (error) {
      if (isOrcaPitAuthRejection(error)) {
        revokeAll(deps, devices, report)
      }
      continue
    }
    // No company shared with the central's owner any more.
    const user = sharedOrcaPitUser(me, central)
    if (!user) {
      revokeAll(deps, devices, report)
      continue
    }
    for (const device of devices) {
      // A JWT that now names someone else is not this row's person any more.
      if (device.orcaPitUser && device.orcaPitUser.id !== 0 && device.orcaPitUser.id !== user.id) {
        revokeAll(deps, [device], report)
      } else if (!device.orcaPitUser || !sameUser(device.orcaPitUser, user)) {
        if (deps.updateUser(device.deviceId, user)) {
          report.updated.push(device.deviceId)
        }
      }
    }
  }
  return report
}

function revokeAll(
  deps: OrcaPitRevalidationDeps,
  devices: readonly DeviceEntry[],
  report: OrcaPitRevalidationReport
): void {
  for (const device of devices) {
    try {
      if (deps.revoke(device.deviceId)) {
        report.revoked.push(device.deviceId)
      }
    } catch (error) {
      console.error('[orca-pit] revoke after revalidation failed:', error)
    }
  }
}

export class OrcaPitRevalidator {
  private timer: NodeJS.Timeout | null = null
  private running: Promise<void> | null = null

  constructor(private readonly deps: OrcaPitRevalidationDeps) {}

  start(): void {
    if (this.timer) {
      return
    }
    const first = setTimeout(() => this.runNow(), FIRST_RUN_DELAY_MS)
    first.unref?.()
    this.timer = setInterval(() => this.runNow(), REVALIDATE_EVERY_MS)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
    }
    this.timer = null
  }

  runNow(): void {
    this.running ??= revalidateOrcaPitDevices(this.deps)
      .then((report) => {
        if (report.revoked.length > 0) {
          console.info(`[orca-pit] revoked ${report.revoked.length} access(es) after revalidation`)
        }
      })
      .catch((error: unknown) => console.warn('[orca-pit] revalidation failed:', error))
      .finally(() => {
        this.running = null
      })
  }
}
