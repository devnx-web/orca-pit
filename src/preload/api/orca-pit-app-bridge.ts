// Orca-Pit: window.api.orcaPit (see shared/orca-pit-app-session).
import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const orcaPitAppApi = {
  getSession: () => ipcRenderer.invoke('orcaPit:getSession'),
  login: (email, password) => ipcRenderer.invoke('orcaPit:login', email, password),
  logout: () => ipcRenderer.invoke('orcaPit:logout'),
  loginToServer: (input) => ipcRenderer.invoke('orcaPit:loginToServer', input),
  getPublicAddress: () => ipcRenderer.invoke('orcaPit:getPublicAddress'),
  setPublicAddress: (address) => ipcRenderer.invoke('orcaPit:setPublicAddress', address),
  listMachines: (force) => ipcRenderer.invoke('orcaPit:listMachines', force === true),
  getMachineState: () => ipcRenderer.invoke('orcaPit:getMachineState')
} satisfies PreloadApi['orcaPit']
