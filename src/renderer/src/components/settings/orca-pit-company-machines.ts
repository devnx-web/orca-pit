// Orca-Pit: what each row of "Company machines" offers, decided apart from the markup so the
// rules (this computer, pending, offline, already saved, outdated) are tested on their own.
import type { OrcaPitMachine, OrcaPitMachineSelfState } from '../../../../shared/orca-pit-machines'
import { isOrcaPitMachineEndpoint } from '../../../../shared/orca-pit-machines'

export type OrcaPitMachineRowAction =
  | { kind: 'this-computer' }
  | { kind: 'pending' }
  | { kind: 'disabled' }
  | { kind: 'offline' }
  | { kind: 'saved'; environmentId: string }
  | { kind: 'connect' }

type SavedServer = { id: string; endpoints: readonly { endpoint: string }[] }

export function orcaPitMachineRowAction(
  machine: OrcaPitMachine,
  self: OrcaPitMachineSelfState,
  saved: readonly SavedServer[]
): OrcaPitMachineRowAction {
  if (self.kind === 'registered' && self.machine.id === machine.id) {
    return { kind: 'this-computer' }
  }
  if (machine.status === 'pending') {
    return { kind: 'pending' }
  }
  if (machine.status === 'disabled') {
    return { kind: 'disabled' }
  }
  const existing = saved.find((server) =>
    server.endpoints.some((entry) => isOrcaPitMachineEndpoint(entry.endpoint, machine))
  )
  if (existing) {
    return { kind: 'saved', environmentId: existing.id }
  }
  return machine.online ? { kind: 'connect' } : { kind: 'offline' }
}

/** The `N` of `x.y.z-pitN`, or null for a version without it. */
export function orcaPitReleaseNumber(version: string | null): number | null {
  const match = version ? /-pit(\d+)$/.exec(version) : null
  return match ? Number(match[1]) : null
}

/** Behind the newest release any machine of the company runs. */
export function isOrcaPitMachineOutdated(
  machine: OrcaPitMachine,
  machines: readonly OrcaPitMachine[]
): boolean {
  const own = orcaPitReleaseNumber(machine.version)
  const newest = Math.max(...machines.map((entry) => orcaPitReleaseNumber(entry.version) ?? 0), 0)
  return own !== null && own < newest
}

/** Most useful first: this computer, then online, then by name. */
export function sortOrcaPitMachines(
  machines: readonly OrcaPitMachine[],
  selfId: number | null
): OrcaPitMachine[] {
  return [...machines].sort((a, b) => {
    const rank = (machine: OrcaPitMachine): number =>
      machine.id === selfId ? 0 : machine.online ? 1 : 2
    return rank(a) - rank(b) || a.name.localeCompare(b.name)
  })
}
