import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const devnxControlApi = {
  getStatus: () => ipcRenderer.invoke('devnxControl:getStatus'),
  connect: (input) => ipcRenderer.invoke('devnxControl:connect', input),
  logout: () => ipcRenderer.invoke('devnxControl:logout'),
  refresh: (options) => ipcRenderer.invoke('devnxControl:refresh', options),
  listAccounts: () => ipcRenderer.invoke('devnxControl:listAccounts'),
  selectAccount: (provider, accountId) =>
    ipcRenderer.invoke('devnxControl:selectAccount', provider, accountId)
} satisfies PreloadApi['devnxControl']
