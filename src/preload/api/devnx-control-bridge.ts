import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const devnxControlApi = {
  getStatus: () => ipcRenderer.invoke('devnxControl:getStatus'),
  connect: (input) => ipcRenderer.invoke('devnxControl:connect', input),
  logout: () => ipcRenderer.invoke('devnxControl:logout'),
  refresh: (options) => ipcRenderer.invoke('devnxControl:refresh', options),
  listAccounts: () => ipcRenderer.invoke('devnxControl:listAccounts'),
  selectAccount: (provider, accountId) =>
    ipcRenderer.invoke('devnxControl:selectAccount', provider, accountId),
  getInstalledRelease: () => ipcRenderer.invoke('devnxControl:getInstalledRelease'),
  checkForUpdate: () => ipcRenderer.invoke('devnxControl:checkForUpdate'),
  installUpdate: () => ipcRenderer.invoke('devnxControl:installUpdate'),
  listProjects: (input) => ipcRenderer.invoke('devnxControl:listProjects', input),
  listTasks: (query) => ipcRenderer.invoke('devnxControl:listTasks', query),
  getTask: (taskId) => ipcRenderer.invoke('devnxControl:getTask', taskId),
  onOpenUpdates: (callback) => {
    const listener = (): void => callback()
    ipcRenderer.on('devnxControl:openUpdates', listener)
    return () => {
      ipcRenderer.removeListener('devnxControl:openUpdates', listener)
    }
  }
} satisfies PreloadApi['devnxControl']
