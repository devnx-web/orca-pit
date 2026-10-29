// Orca-Pit: starts the activity diary with the app: opens the SQLite file, follows agent
// status rows for start/stop and this window's settings saves, and ships pending events to
// the Control in the background.
import { join } from 'node:path'
import { mainProcessState as state } from '../startup/main-process-state'
import { orcaPitActivityCapture } from './orca-pit-activity-capture'
import { centralConnection } from './orca-pit-activity-control'
import { OrcaPitAgentTracker, type OrcaPitAgentStatusSource } from './orca-pit-activity-agents'
import { actorForCaller } from './orca-pit-activity-context'
import { orcaPitUserForDevice } from './orca-pit-identity'
import { ORCA_PIT_ACTIVITY_DB_FILE, OrcaPitActivityDb } from './orca-pit-activity-db'
import { installOrcaPitActivityCapture } from './orca-pit-activity-hooks'
import { orcaPitActivity } from './orca-pit-activity-recorder'
import { OrcaPitActivitySender } from './orca-pit-activity-sender'
import { providerSessionTotals, tokenDelta } from './orca-pit-activity-tokens'

let running: {
  db: OrcaPitActivityDb
  tracker: OrcaPitAgentTracker
  sender: OrcaPitActivitySender
  unsubscribeSettings: () => void
} | null = null

// Why only with an origin window: that is this computer's settings screen; remote clients'
// settings.* RPCs are signed in the dispatcher hook, and internal writes are nobody's action.
function recordDesktopSettings(updates: object, originWebContentsId?: number): void {
  const keys = Object.keys(updates)
  if (originWebContentsId !== undefined && keys.length > 0) {
    orcaPitActivity.recordSimple(
      'settings_changed',
      actorForCaller({ kind: 'desktop' }),
      null,
      keys.join(', ')
    )
  }
}

export function startOrcaPitActivity(
  userDataPath: string,
  statusSource: OrcaPitAgentStatusSource
): void {
  if (running) {
    return
  }
  let db: OrcaPitActivityDb
  try {
    db = new OrcaPitActivityDb(join(userDataPath, ORCA_PIT_ACTIVITY_DB_FILE))
  } catch (error) {
    // Without the diary Orca still works; nothing is recorded.
    console.warn('[orca-pit] activity diary unavailable:', error)
    return
  }
  const tracker = new OrcaPitAgentTracker({
    record: (draft) => orcaPitActivity.record(draft),
    actorForPane: (paneKey) => orcaPitActivity.actorForPane(paneKey),
    tokensForStop: async (agent, providerSessionId) => {
      const totals = await providerSessionTotals(agent, providerSessionId)
      if (!totals || !providerSessionId) {
        return null
      }
      const delta = tokenDelta(totals, db.tokenBaseline(providerSessionId))
      db.saveTokenBaseline(providerSessionId, totals.tokensIn, totals.tokensOut)
      return delta
    }
  })
  orcaPitActivity.attach(db, (paneKey) => tracker.agentForPane(paneKey))
  tracker.attach(statusSource)
  const sender = new OrcaPitActivitySender({
    db,
    connection: centralConnection,
    owner: async () => orcaPitUserForDevice(null),
    flushRecorder: () => orcaPitActivity.flush()
  })
  sender.start()
  installOrcaPitActivityCapture(orcaPitActivityCapture)
  const unsubscribeSettings =
    state.store?.onSettingsChanged((updates, _settings, origin) =>
      recordDesktopSettings(updates, origin)
    ) ?? (() => {})
  running = { db, tracker, sender, unsubscribeSettings }
}

export function stopOrcaPitActivity(): void {
  if (!running) {
    return
  }
  installOrcaPitActivityCapture(null)
  running.unsubscribeSettings()
  running.sender.stop()
  running.tracker.detach()
  orcaPitActivity.detach()
  running.db.close()
  running = null
}
