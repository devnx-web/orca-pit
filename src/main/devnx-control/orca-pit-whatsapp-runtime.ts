// Orca-Pit: wires the WhatsApp bridge into the desktop. It reads the inbox at start, every 60 s and
// whenever the router wakes it, and only while this machine has its Control session and is approved
// in the company directory (the Control hands out only the groups linked to it). Headless orcad
// never calls this.
import { app } from 'electron'
import { join } from 'node:path'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { getOrcaPitAppSession, getOrcaPitCentral } from './orca-pit-app'
import { getOrcaPitMachineState, getOrcaPitMachineUid } from './orca-pit-machines-runtime'
import { whatsappMachineCalls, type OrcaPitWhatsappMachineCalls } from './orca-pit-whatsapp-api'
import { WhatsappBridge } from './orca-pit-whatsapp-bridge'
import {
  createWhatsappConversations,
  type WhatsappRepoStore
} from './orca-pit-whatsapp-conversations'
import { setOrcaPitWhatsappHost } from './orca-pit-whatsapp-host'
import { WhatsappBridgeState } from './orca-pit-whatsapp-state'

// Why 60 s: the router's wake is best effort; a minute is the longest a message waits without it.
const POLL_MS = 60_000

let bridge: WhatsappBridge | null = null

/** The approved machine's id in the Control, or null. */
function approvedMachine(): { id: number; name: string } | null {
  const self = getOrcaPitMachineState()
  return self.kind === 'registered' && self.machine.status === 'approved'
    ? { id: self.machine.id, name: self.machine.name }
    : null
}

function machineCalls(): OrcaPitWhatsappMachineCalls | null {
  const session = getOrcaPitCentral().currentSession()
  const uid = getOrcaPitMachineUid()
  if (!session || !uid || !approvedMachine()) {
    return null
  }
  return whatsappMachineCalls(
    session.baseUrl,
    () =>
      [getOrcaPitAppSession().controlToken(), session.token].filter(
        (token): token is string => !!token
      ),
    uid
  )
}

/** A nudge for the bridge now: after a link changed here, or the router's wake. */
function wakeOrcaPitWhatsapp(): void {
  void bridge?.tick()
}

export function installOrcaPitWhatsapp(
  runtime: OrcaRuntimeService,
  store: WhatsappRepoStore
): void {
  if (bridge) {
    return
  }
  // The file is shared with the project settings that choose a group's Orca project.
  const state = new WhatsappBridgeState(
    join(app.getPath('userData'), 'devnx-control', 'orca-pit-whatsapp.json')
  )
  const conversations = createWhatsappConversations(
    runtime,
    store,
    (groupId) => state.group(groupId).repoId
  )
  const current = new WhatsappBridge({
    calls: machineCalls,
    conversations,
    state,
    now: Date.now,
    wait: (ms) =>
      new Promise((resolve) => {
        setTimeout(() => resolve('timeout'), ms).unref()
      })
  })
  bridge = current
  const unwatch = conversations.watch((event) => current.observe(event))
  setOrcaPitWhatsappHost({
    personToken: () => getOrcaPitAppSession().controlToken(),
    approvedMachine,
    state,
    wake: wakeOrcaPitWhatsapp
  })
  // The machine agent registers on its own first beat; the first round usually finds it approved.
  const first = setTimeout(wakeOrcaPitWhatsapp, 5_000)
  first.unref()
  const timer = setInterval(wakeOrcaPitWhatsapp, POLL_MS)
  timer.unref()
  app.on('will-quit', () => {
    clearTimeout(first)
    clearInterval(timer)
    setOrcaPitWhatsappHost(null)
    unwatch()
    conversations.dispose()
  })
}
