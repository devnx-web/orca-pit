// Orca-Pit: IPC for window.api.orcaPit (shared/orca-pit-app-session): the app's sign-in screen,
// "Add server" by Control login and the share address.
import { ipcMain } from 'electron'
import { isRecord } from '../devnx-control/devnx-control-http'
import { getOrcaPitAppSession, orcaPitPublicAddressFile } from '../devnx-control/orca-pit-app'
import {
  readOrcaPitPublicAddress,
  writeOrcaPitPublicAddress
} from '../devnx-control/orca-pit-public-address'
import { loginToOrcaPitServer } from '../devnx-control/orca-pit-server-login'

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

export function registerOrcaPitAppHandlers(): void {
  ipcMain.handle('orcaPit:getSession', () => getOrcaPitAppSession().state())
  ipcMain.handle('orcaPit:login', (_event, email: unknown, password: unknown) =>
    getOrcaPitAppSession().login(text(email, 254), text(password, 1024))
  )
  ipcMain.handle('orcaPit:logout', () => getOrcaPitAppSession().logout())
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
