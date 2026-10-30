// Orca-Pit: the per-app singletons behind window.api.orcaPit: the machine's Control identity
// (shared with the multi-user server), the person signed in to this app and the share address.
import { app } from 'electron'
import { join } from 'node:path'
import { getDevnxControlService } from './devnx-control-service'
import { OrcaPitAppSession } from './orca-pit-app-session'
import { OrcaPitCentral } from './orca-pit-control-me'

let central: OrcaPitCentral | null = null
let appSession: OrcaPitAppSession | null = null

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
