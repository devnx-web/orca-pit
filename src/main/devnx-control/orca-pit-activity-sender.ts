// Orca-Pit: ships the diary to the Control every 2 minutes, at most 500 events per call
// (contract item 5). Accepted and duplicate events are done; refused ones keep their reason
// and stop after a few attempts; a network failure just waits for the next round.
import { hostname } from 'node:os'
import {
  DevnxControlError,
  isRecord,
  publicErrorMessage,
  requestDevnxControl
} from './devnx-control-http'
import type { DevnxConnection } from './devnx-control-store'
import type { OrcaPitActivityDb, OrcaPitRejection } from './orca-pit-activity-db'
import { ORCA_PIT_ACTIVITY_API_PATHS } from './orca-pit-activity-control'
import type { OrcaPitActivityEvent } from './orca-pit-activity-types'
import type { OrcaPitUser } from './orca-pit-identity-types'

export const ORCA_PIT_SEND_INTERVAL_MS = 2 * 60_000
export const ORCA_PIT_SEND_BATCH = 500
// Why a cap per round: a long outage drains over a few rounds instead of one long burst.
const MAX_BATCHES_PER_ROUND = 10
const PRUNE_EVERY_MS = 6 * 60 * 60_000

export type OrcaPitIngestResult = {
  accepted: number
  duplicates: number
  rejected: OrcaPitRejection[]
}

/** Reads the ingest reply; a refusal without id points at the batch index. */
export function parseIngestResult(
  payload: unknown,
  batch: readonly OrcaPitActivityEvent[]
): OrcaPitIngestResult {
  const record = isRecord(payload) ? payload : {}
  const rejected: OrcaPitRejection[] = []
  for (const item of Array.isArray(record.rejected) ? record.rejected : []) {
    if (!isRecord(item)) {
      continue
    }
    const index = Number(item.index)
    const id =
      typeof item.id === 'string' && item.id
        ? item.id
        : Number.isInteger(index)
          ? batch[index]?.id
          : undefined
    if (id) {
      rejected.push({ id, reason: typeof item.reason === 'string' ? item.reason : 'recusado' })
    }
  }
  return {
    accepted: Number(record.accepted) || 0,
    duplicates: Number(record.duplicates) || 0,
    rejected
  }
}

export type OrcaPitSenderDeps = {
  db: OrcaPitActivityDb
  connection: () => DevnxConnection | null
  owner: () => Promise<OrcaPitUser | null>
  /** Writes recorded in memory but not yet on disk. */
  flushRecorder?: () => void
  post?: typeof requestDevnxControl
  deviceUid?: string
  now?: () => number
}

export class OrcaPitActivitySender {
  private timer: NodeJS.Timeout | null = null
  private running: Promise<void> | null = null
  private lastPruneAt = 0

  constructor(private readonly deps: OrcaPitSenderDeps) {}

  start(): void {
    if (this.timer) {
      return
    }
    this.timer = setInterval(() => void this.sendNow(), ORCA_PIT_SEND_INTERVAL_MS)
    this.timer.unref?.()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
    }
    this.timer = null
  }

  sendNow(): Promise<void> {
    this.running ??= this.round().finally(() => {
      this.running = null
    })
    return this.running
  }

  private async round(): Promise<void> {
    const now = this.deps.now ?? Date.now
    const { db } = this.deps
    if (now() - this.lastPruneAt > PRUNE_EVERY_MS) {
      this.lastPruneAt = now()
      db.prune(now())
    }
    const connection = this.deps.connection()
    if (!connection) {
      return
    }
    this.deps.flushRecorder?.()
    const owner = await this.deps.owner()
    if (owner) {
      db.fillLocalOwner(owner.id)
    }
    for (let round = 0; round < MAX_BATCHES_PER_ROUND; round += 1) {
      const batch = db.pending(ORCA_PIT_SEND_BATCH)
      if (batch.length === 0) {
        return
      }
      const sent = await this.sendBatch(connection, batch)
      // Stop on failure, and when every event left was refused this round (no progress).
      if (!sent || batch.length < ORCA_PIT_SEND_BATCH) {
        return
      }
    }
  }

  private async sendBatch(
    connection: DevnxConnection,
    batch: readonly OrcaPitActivityEvent[]
  ): Promise<boolean> {
    const post = this.deps.post ?? requestDevnxControl
    const now = this.deps.now ?? Date.now
    let payload: unknown
    try {
      payload = await post(connection.baseUrl, ORCA_PIT_ACTIVITY_API_PATHS.ingest, {
        method: 'POST',
        token: connection.deviceToken,
        body: { device_uid: this.deps.deviceUid ?? hostname(), events: batch },
        timeoutMs: 60_000
      })
    } catch (error) {
      // Nothing is marked: the next round sends the same events again (ids make it idempotent).
      const status = error instanceof DevnxControlError ? error.status : null
      console.warn(
        `[orca-pit] activity ingest failed${status ? ` (HTTP ${status})` : ''}:`,
        publicErrorMessage(error)
      )
      return false
    }
    const result = parseIngestResult(payload, batch)
    const refused = new Set(result.rejected.map((rejection) => rejection.id))
    // Why: a reply that does not account for the batch (an old back, a proxy page) proves nothing.
    if (result.accepted + result.duplicates < batch.length - refused.size) {
      console.warn('[orca-pit] activity ingest reply does not cover the batch; will retry')
      return false
    }
    this.deps.db.markSent(
      batch.filter((event) => !refused.has(event.id)).map((event) => event.id),
      now()
    )
    this.deps.db.markRejected(result.rejected, now())
    return refused.size < batch.length
  }
}
