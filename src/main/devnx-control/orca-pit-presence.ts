// Orca-Pit: who is around this central Orca right now, for the sidebar of every client. Built on
// demand from what the runtime already tracks: authenticated sockets (who is connected), the
// unpaused terminal streams of each connection (what they have on screen) and, for the person at
// this machine, the system idle clock and the window's active pane.
import { createHash } from 'node:crypto'
import { powerMonitor } from 'electron'
import { isTerminalLeafId } from '../../shared/stable-pane-id'
import type {
  OrcaPitAgentAuthorsResult,
  OrcaPitOnlineEntry,
  OrcaPitPerson
} from '../../shared/orca-pit-presence'
import { readDesktopAwayState } from '../notifications/desktop-away-state'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { RpcCallerIdentity } from '../runtime/rpc/rpc-caller-identity'
import { mainProcessState as state } from '../startup/main-process-state'
import { pairedDeviceName } from './orca-pit-activity-control'
import { orcaPitUserForDevice } from './orca-pit-identity'
import { liveOrcaPitConnections, viewedOrcaPitPtys } from './orca-pit-presence-registry'

export type OrcaPitPresence = Omit<OrcaPitAgentAuthorsResult, 'authors' | 'starters'>

export type OrcaPitPresenceInputs = {
  self: OrcaPitPerson | null
  viewed: readonly { paneKey: string | null; person: OrcaPitPerson }[]
  connections: readonly { person: OrcaPitPerson; device: string; since: number }[]
  /** The person at this machine, when its window is up and the system is not idle. */
  owner: { person: OrcaPitPerson; since: number; activePaneKey: string | null } | null
  machineName: string
  now: number
}

/** Pure: viewers per pane (one entry per person) and one online entry per socket. */
export function buildOrcaPitPresence(inputs: OrcaPitPresenceInputs): OrcaPitPresence {
  const viewers: Record<string, OrcaPitPerson[]> = {}
  const addViewer = (paneKey: string | null, person: OrcaPitPerson): void => {
    if (!paneKey) {
      return
    }
    const list = (viewers[paneKey] ??= [])
    if (!list.some((known) => known.key === person.key)) {
      list.push(person)
    }
  }
  for (const { paneKey, person } of inputs.viewed) {
    addViewer(paneKey, person)
  }
  const online: OrcaPitOnlineEntry[] = inputs.connections.map(({ person, device, since }) => ({
    ...person,
    device,
    since,
    central: false
  }))
  if (inputs.owner) {
    addViewer(inputs.owner.activePaneKey, inputs.owner.person)
    online.push({ ...inputs.owner.person, device: '', since: inputs.owner.since, central: true })
  }
  return {
    viewers,
    online,
    self: inputs.self,
    machineName: inputs.machineName,
    now: inputs.now
  }
}

// Why a hash: every client receives these keys; the device id is an auth subject, not for show.
function deviceKey(deviceId: string): string {
  return `d:${createHash('sha256').update(deviceId).digest('hex').slice(0, 12)}`
}

function ownerPerson(): OrcaPitPerson {
  const owner = orcaPitUserForDevice(null)
  return owner
    ? { key: `u:${owner.id}`, name: owner.name || owner.email, userId: owner.id }
    : { key: 'central', name: 'Computador central', userId: null }
}

function devicePerson(deviceId: string): OrcaPitPerson {
  const user = orcaPitUserForDevice(deviceId)
  return user
    ? { key: `u:${user.id}`, name: user.name || user.email, userId: user.id }
    : { key: deviceKey(deviceId), name: pairedDeviceName(deviceId) ?? 'Aparelho', userId: null }
}

export function orcaPitPersonForCaller(caller: RpcCallerIdentity | undefined): OrcaPitPerson {
  return caller?.kind === 'paired-device' ? devicePerson(caller.deviceId) : ownerPerson()
}

function ownerAtMachine(): boolean {
  const window = state.mainWindow
  if (!window || window.isDestroyed() || !window.isVisible() || window.isMinimized()) {
    return false
  }
  return readDesktopAwayState(powerMonitor) === false
}

/** The terminal pane this machine's window shows, from the session it keeps for itself. */
function ownerActivePaneKey(): string | null {
  const session = state.store?.getWorkspaceSession()
  const tabId = session?.activeTabId
  if (!session || !tabId || tabId.includes(':')) {
    return null
  }
  const worktreeId = session.activeWorktreeId
  const tabType = worktreeId ? session.activeTabTypeByWorktree?.[worktreeId] : undefined
  if (tabType && tabType !== 'terminal') {
    return null
  }
  const leafId = session.terminalLayoutsByTabId?.[tabId]?.activeLeafId
  return leafId && isTerminalLeafId(leafId) ? `${tabId}:${leafId}` : null
}

let ownerSince: number | null = null

function ownerPresence(now: number): OrcaPitPresenceInputs['owner'] {
  if (!ownerAtMachine()) {
    ownerSince = null
    return null
  }
  ownerSince ??= now
  return { person: ownerPerson(), since: ownerSince, activePaneKey: ownerActivePaneKey() }
}

export function orcaPitPresence(
  runtime: Pick<OrcaRuntimeService, 'wslMovePaneKeyForPty' | 'readMachineName'>,
  caller: RpcCallerIdentity | undefined
): OrcaPitPresence {
  const now = Date.now()
  const people = new Map<string, OrcaPitPerson>()
  const personOf = (deviceId: string): OrcaPitPerson => {
    let person = people.get(deviceId)
    if (!person) {
      person = devicePerson(deviceId)
      people.set(deviceId, person)
    }
    return person
  }
  const viewed = viewedOrcaPitPtys().flatMap(({ ptyId, caller: viewer }) =>
    viewer?.kind === 'paired-device'
      ? [{ paneKey: runtime.wslMovePaneKeyForPty(ptyId), person: personOf(viewer.deviceId) }]
      : []
  )
  const connections = liveOrcaPitConnections().map(({ deviceId, since }) => ({
    person: personOf(deviceId),
    device: pairedDeviceName(deviceId) ?? 'Aparelho',
    since
  }))
  return buildOrcaPitPresence({
    self: orcaPitPersonForCaller(caller),
    viewed,
    connections,
    owner: ownerPresence(now),
    machineName: runtime.readMachineName(),
    now
  })
}
