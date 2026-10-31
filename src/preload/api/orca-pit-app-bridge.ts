// Orca-Pit: window.api.orcaPit (see shared/orca-pit-app-session).
import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const orcaPitAppApi = {
  getSession: () => ipcRenderer.invoke('orcaPit:getSession'),
  login: (email, password) => ipcRenderer.invoke('orcaPit:login', email, password),
  logout: () => ipcRenderer.invoke('orcaPit:logout'),
  resume: () => ipcRenderer.invoke('orcaPit:resume'),
  onSessionChanged: (listener) => {
    const handler = (_event: unknown, state: Parameters<typeof listener>[0]): void =>
      listener(state)
    ipcRenderer.on('orcaPit:sessionChanged', handler)
    return () => {
      ipcRenderer.removeListener('orcaPit:sessionChanged', handler)
    }
  },
  loginToServer: (input) => ipcRenderer.invoke('orcaPit:loginToServer', input),
  getPublicAddress: () => ipcRenderer.invoke('orcaPit:getPublicAddress'),
  setPublicAddress: (address) => ipcRenderer.invoke('orcaPit:setPublicAddress', address),
  listMachines: (force) => ipcRenderer.invoke('orcaPit:listMachines', force === true),
  getMachineState: () => ipcRenderer.invoke('orcaPit:getMachineState')
} satisfies PreloadApi['orcaPit']
