// Orca-Pit: IPC for the Control projects picker and the DevNX source in Tasks. Read-only:
// v1 never moves a card; the desktop opens the task's own page in the Control front for that.
import { ipcMain } from 'electron'
import type { DevnxControlResult } from '../../shared/devnx-control-types'
import type { DevnxControlTaskQuery } from '../../shared/orca-pit-devnx-tasks'
import { mainProcessState as state } from '../startup/main-process-state'
import { isRecord, publicErrorMessage } from './devnx-control-http'
import { getDevnxControlService } from './devnx-control-service'
import { getDevnxTask, listDevnxTasks, type DevnxControlReader } from './orca-pit-control-tasks'
import { listDevnxProjectsForRepo } from './orca-pit-control-projects'

async function withReader<T>(
  action: (reader: DevnxControlReader) => Promise<T>
): Promise<DevnxControlResult<T>> {
  const service = getDevnxControlService()
  if (!service?.client.isConnected()) {
    return { ok: false, error: 'Orca não está conectado ao DevNX Control.' }
  }
  try {
    return { ok: true, value: await action(service.client) }
  } catch (error) {
    return { ok: false, error: publicErrorMessage(error) }
  }
}

function taskQuery(input: unknown): DevnxControlTaskQuery {
  const raw = isRecord(input) ? input : {}
  return {
    projectId: typeof raw.projectId === 'number' ? raw.projectId : 0,
    search: typeof raw.search === 'string' ? raw.search : undefined,
    statuses: Array.isArray(raw.statuses)
      ? raw.statuses.filter((status): status is string => typeof status === 'string')
      : undefined,
    mine: raw.mine === true,
    limit: typeof raw.limit === 'number' ? raw.limit : undefined
  }
}

export function registerOrcaPitTaskHandlers(): void {
  ipcMain.handle('devnxControl:listProjects', (_event, input: unknown) =>
    withReader((reader) => {
      const raw = isRecord(input) ? input : {}
      const repoId = typeof raw.repoId === 'string' ? raw.repoId : null
      return listDevnxProjectsForRepo(reader, repoId ? state.store?.getRepo(repoId) : null, {
        search: typeof raw.search === 'string' ? raw.search : undefined
      })
    })
  )
  ipcMain.handle('devnxControl:listTasks', (_event, input: unknown) =>
    withReader((reader) => listDevnxTasks(reader, taskQuery(input)))
  )
  ipcMain.handle('devnxControl:getTask', (_event, taskId: unknown) =>
    withReader((reader) => getDevnxTask(reader, typeof taskId === 'number' ? taskId : 0))
  )
}
