// Orca-Pit: IPC for window.api.orcaPit (shared/orca-pit-app-session): the app's sign-in screen,
// "Add server" by Control login, the share address and the company's machine directory.
import { ipcMain } from 'electron'
import { isRecord } from '../devnx-control/devnx-control-http'
import {
  getOrcaPitAppSession,
  getOrcaPitPresenceWatch,
  orcaPitPublicAddressFile,
  startOrcaPitPresenceWatch
} from '../devnx-control/orca-pit-app'
import {
  readOrcaPitPublicAddress,
  writeOrcaPitPublicAddress
} from '../devnx-control/orca-pit-public-address'
import { loginToOrcaPitServer } from '../devnx-control/orca-pit-server-login'
import {
  getOrcaPitMachineDirectory,
  getOrcaPitMachineState,
  kickOrcaPitMachineAgent
} from '../devnx-control/orca-pit-machines-runtime'

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

export function registerOrcaPitAppHandlers(): void {
  startOrcaPitPresenceWatch()
  ipcMain.handle('orcaPit:getSession', () => getOrcaPitAppSession().state())
  ipcMain.handle('orcaPit:login', async (_event, email: unknown, password: unknown) => {
    const result = await getOrcaPitAppSession().login(text(email, 254), text(password, 1024))
    if (result.ok) {
      // The first sign-in on a machine registers it in the company directory right away.
      kickOrcaPitMachineAgent()
      getOrcaPitPresenceWatch().onLogin()
    }
    return result
  })
  ipcMain.handle('orcaPit:logout', () => {
    getOrcaPitPresenceWatch().onLeave()
    return getOrcaPitAppSession().logout()
  })
  ipcMain.handle('orcaPit:resume', () => {
    const session = getOrcaPitAppSession()
    if (!session.isAway()) {
      return session.state()
    }
    getOrcaPitPresenceWatch().onResume()
    return session.resume()
  })
  ipcMain.handle('orcaPit:loginToServer', (_event, input: unknown) => {
    const raw = isRecord(input) ? input : {}
    return loginToOrcaPitServer(
      { controlToken: () => getOrcaPitAppSession().controlToken() },
      {
        address: text(raw.address, 512),
        email: text(raw.email, 254) || undefined,
        password: text(raw.password, 1024) || undefined
      }
    )
  })
  ipcMain.handle('orcaPit:listMachines', (_event, force: unknown) =>
    getOrcaPitMachineDirectory().list(force === true)
  )
  ipcMain.handle('orcaPit:getMachineState', () => getOrcaPitMachineState())
  ipcMain.handle('orcaPit:getPublicAddress', () =>
    readOrcaPitPublicAddress(orcaPitPublicAddressFile())
  )
  ipcMain.handle('orcaPit:setPublicAddress', (_event, address: unknown) =>
    writeOrcaPitPublicAddress(
      orcaPitPublicAddressFile(),
      typeof address === 'string' ? address.slice(0, 512) : null
    )
  )
}
