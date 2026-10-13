import { ipcMain } from 'electron'
import {
  DEVNX_CONTROL_DEFAULT_BASE_URL,
  type DevnxControlResult,
  type DevnxControlStatus
} from '../../shared/devnx-control-types'
import { publicErrorMessage, isRecord } from '../devnx-control/devnx-control-http'
import { normalizeProvider } from '../devnx-control/devnx-control-payloads'
import {
  getDevnxControlService,
  type DevnxControlService
} from '../devnx-control/devnx-control-service'

const DISCONNECTED_STATUS: DevnxControlStatus = {
  connected: false,
  baseUrl: DEVNX_CONTROL_DEFAULT_BASE_URL,
  selected: {},
  lastSyncAt: null,
  warnings: []
}

async function run<T>(
  action: (service: DevnxControlService) => Promise<T>
): Promise<DevnxControlResult<T>> {
  const service = getDevnxControlService()
  if (!service) {
    return { ok: false, error: 'DevNX Control ainda não iniciou.' }
  }
  try {
    return { ok: true, value: await action(service) }
  } catch (error) {
    return { ok: false, error: publicErrorMessage(error) }
  }
}

export function registerDevnxControlHandlers(): void {
  ipcMain.handle(
    'devnxControl:getStatus',
    () => getDevnxControlService()?.status() ?? DISCONNECTED_STATUS
  )
  ipcMain.handle('devnxControl:connect', (_event, input: unknown) =>
    run((service) => {
      const raw = isRecord(input) ? input : {}
      return service.connect({
        baseUrl: typeof raw.baseUrl === 'string' ? raw.baseUrl : undefined,
        email: typeof raw.email === 'string' ? raw.email : '',
        password: typeof raw.password === 'string' ? raw.password : ''
      })
    })
  )
  ipcMain.handle('devnxControl:logout', () => run((service) => service.logout()))
  ipcMain.handle('devnxControl:refresh', (_event, options: unknown) =>
    run((service) =>
      service.refresh({
        syncUsage: isRecord(options) && options.syncUsage === true
      })
    )
  )
  ipcMain.handle('devnxControl:listAccounts', () => run((service) => service.listAccounts()))
  ipcMain.handle('devnxControl:selectAccount', (_event, provider: unknown, accountId: unknown) =>
    run(async (service) => {
      const normalized = normalizeProvider(provider)
      if (!normalized || typeof accountId !== 'string' || !accountId.trim()) {
        throw new Error('Plataforma ou conta inválida.')
      }
      return service.selectAccount(normalized, accountId.trim())
    })
  )
}
