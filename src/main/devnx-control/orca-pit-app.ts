// Orca-Pit: the per-app singletons behind window.api.orcaPit: the machine's Control identity
// (shared with the multi-user server), the person signed in to this app and the share address.
import { app, BrowserWindow, powerMonitor } from 'electron'
import { join } from 'node:path'
import { getDevnxControlService } from './devnx-control-service'
import { OrcaPitAppSession } from './orca-pit-app-session'
import { actorForCaller } from './orca-pit-activity-context'
import { orcaPitActivity } from './orca-pit-activity-recorder'
import { OrcaPitCentral } from './orca-pit-control-me'
import { OrcaPitPresenceWatch } from './orca-pit-presence-watch'

let central: OrcaPitCentral | null = null
let appSession: OrcaPitAppSession | null = null
let presenceWatch: OrcaPitPresenceWatch | null = null

/** This machine's own Control session and owner, one cache for the app and the server. */
export function getOrcaPitCentral(): OrcaPitCentral {
  central ??= new OrcaPitCentral(() => getDevnxControlService()?.client.session() ?? null)
  return central
}

export function getOrcaPitAppSession(): OrcaPitAppSession {
  appSession ??= new OrcaPitAppSession({
    session: () => getOrcaPitCentral().currentSession(),
    centralMe: () => getOrcaPitCentral().me(),
    filePath: join(app.getPath('userData'), 'devnx-control', 'orca-pit-app-login.json')
  })
  return appSession
}

export function orcaPitPublicAddressFile(): string {
  return join(app.getPath('userData'), 'orca-pit-public-address.json')
}

/** Sends the app's session state to every window (the idle screen comes up from here). */
export function pushOrcaPitAppSession(): void {
  const state = getOrcaPitAppSession().state()
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('orcaPit:sessionChanged', state)
    }
  }
}

export function getOrcaPitPresenceWatch(): OrcaPitPresenceWatch {
  if (!presenceWatch) {
    const session = getOrcaPitAppSession()
    presenceWatch = new OrcaPitPresenceWatch({
      idleSeconds: () => powerMonitor.getSystemIdleTime(),
      isSignedIn: () => session.isSignedIn(),
      isAway: () => session.isAway(),
      markAway: (since) => session.markAway(since),
      // The app's person is the desktop caller: "<Nome> · app".
      record: (action, atMs) =>
        orcaPitActivity.recordPresence(action, actorForCaller({ kind: 'desktop' }), atMs),
      notify: pushOrcaPitAppSession
    })
  }
  return presenceWatch
}

/** Starts the idle check once the app is ready (powerMonitor needs it). */
export function startOrcaPitPresenceWatch(): void {
  void app.whenReady().then(() => {
    const watch = getOrcaPitPresenceWatch()
    watch.start()
    powerMonitor.on('suspend', () => watch.onPause())
    powerMonitor.on('lock-screen', () => watch.onPause())
    powerMonitor.on('resume', () => watch.onWake())
    powerMonitor.on('unlock-screen', () => watch.onWake())
    app.on('before-quit', () => watch.onLeave())
  })
}
