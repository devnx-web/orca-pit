// Orca-Pit: the diary on disk. One SQLite file in userData, written in small batches and
// read by the sender; sent events stay 90 days so the central machine keeps its own history.
import Database from '../sqlite/sync-database'
import type { SqliteRow } from '../sqlite/sqlite-statement'
import {
  brasiliaIso,
  makeActivityId,
  type OrcaPitActivityAction,
  type OrcaPitActivityDraft,
  type OrcaPitActivityEvent
} from './orca-pit-activity-types'

export const ORCA_PIT_ACTIVITY_DB_FILE = 'orca-pit-activity.db'
export const ORCA_PIT_ACTIVITY_RETENTION_MS = 90 * 24 * 60 * 60 * 1000
// Why a cap: a rejection is usually final (user of another company); a few retries cover a
// membership that was still being created.
export const ORCA_PIT_MAX_REJECTED_ATTEMPTS = 5

const STATUS_PENDING = 0
const STATUS_SENT = 1
const STATUS_REJECTED = 2

const SCHEMA = `
CREATE TABLE IF NOT EXISTS orca_pit_activity (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  at_ms INTEGER NOT NULL,
  action TEXT NOT NULL,
  user_id INTEGER,
  local_actor INTEGER NOT NULL DEFAULT 0,
  device_label TEXT,
  project_id INTEGER,
  task_id INTEGER,
  orca_project TEXT,
  workspace TEXT,
  session_id TEXT,
  agent TEXT,
  tokens_in INTEGER,
  tokens_out INTEGER,
  detail TEXT,
  sent INTEGER NOT NULL DEFAULT 0,
  sent_at_ms INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  reject_reason TEXT
);
CREATE INDEX IF NOT EXISTS orca_pit_activity_pending ON orca_pit_activity (sent, at_ms);
CREATE TABLE IF NOT EXISTS orca_pit_session_tokens (
  session_id TEXT PRIMARY KEY,
  tokens_in INTEGER NOT NULL,
  tokens_out INTEGER NOT NULL
);
`

const EVENT_COLUMNS =
  'id, at, user_id, device_label, action, project_id, task_id, orca_project, workspace, session_id, agent, tokens_in, tokens_out, detail'

function text(row: SqliteRow, key: string): string | null {
  const value = row[key]
  return typeof value === 'string' ? value : null
}

function int(row: SqliteRow, key: string): number | null {
  const value = row[key]
  return typeof value === 'number' || typeof value === 'bigint' ? Number(value) : null
}

function toEvent(row: SqliteRow): OrcaPitActivityEvent {
  return {
    id: text(row, 'id') ?? '',
    user_id: int(row, 'user_id'),
    device_label: text(row, 'device_label'),
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only insert() writes this column, from the typed action union.
    action: (text(row, 'action') ?? 'terminal_line') as OrcaPitActivityAction,
    project_id: int(row, 'project_id'),
    task_id: int(row, 'task_id'),
    orca_project: text(row, 'orca_project'),
    workspace: text(row, 'workspace'),
    session_id: text(row, 'session_id'),
    agent: text(row, 'agent'),
    tokens_in: int(row, 'tokens_in'),
    tokens_out: int(row, 'tokens_out'),
    detail: text(row, 'detail'),
    at: text(row, 'at') ?? ''
  }
}

export type OrcaPitRejection = { id: string; reason: string }

export class OrcaPitActivityDb {
  private readonly db: Database

  constructor(path: string) {
    this.db = new Database(path)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec(SCHEMA)
  }

  private transaction(run: () => void): void {
    this.db.exec('BEGIN')
    try {
      run()
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  insert(drafts: readonly OrcaPitActivityDraft[]): string[] {
    const ids: string[] = []
    const statement = this.db.prepare(
      `INSERT INTO orca_pit_activity (${EVENT_COLUMNS}, at_ms, local_actor)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    this.transaction(() => {
      for (const draft of drafts) {
        const id = makeActivityId(draft.atMs)
        statement.run(
          id,
          brasiliaIso(draft.atMs),
          draft.user_id,
          draft.device_label,
          draft.action,
          draft.project_id,
          draft.task_id,
          draft.orca_project,
          draft.workspace,
          draft.session_id,
          draft.agent,
          draft.tokens_in,
          draft.tokens_out,
          draft.detail,
          draft.atMs,
          draft.localActor ? 1 : 0
        )
        ids.push(id)
      }
    })
    return ids
  }

  /** Oldest first, so a long outage drains in the order things happened. */
  pending(limit: number): OrcaPitActivityEvent[] {
    return this.db
      .prepare(
        `SELECT ${EVENT_COLUMNS} FROM orca_pit_activity WHERE sent = ${STATUS_PENDING} ORDER BY at_ms, id LIMIT ?`
      )
      .all(limit)
      .map(toEvent)
  }

  /** The owner's id becomes known after the events: stamp it before they leave. */
  fillLocalOwner(userId: number): void {
    this.db
      .prepare(
        `UPDATE orca_pit_activity SET user_id = ? WHERE local_actor = 1 AND user_id IS NULL AND sent = ${STATUS_PENDING}`
      )
      .run(userId)
  }

  markSent(ids: readonly string[], nowMs: number): void {
    const statement = this.db.prepare(
      `UPDATE orca_pit_activity SET sent = ${STATUS_SENT}, sent_at_ms = ?, reject_reason = NULL WHERE id = ?`
    )
    this.transaction(() => {
      for (const id of ids) {
        statement.run(nowMs, id)
      }
    })
  }

  /** Keeps the reason; after the last attempt the event stays only in this diary. */
  markRejected(rejections: readonly OrcaPitRejection[], nowMs: number): void {
    const statement = this.db.prepare(
      `UPDATE orca_pit_activity
       SET attempts = attempts + 1,
           reject_reason = ?,
           sent = CASE WHEN attempts + 1 >= ? THEN ${STATUS_REJECTED} ELSE sent END,
           sent_at_ms = CASE WHEN attempts + 1 >= ? THEN ? ELSE sent_at_ms END
       WHERE id = ?`
    )
    this.transaction(() => {
      for (const rejection of rejections) {
        statement.run(
          rejection.reason.slice(0, 240),
          ORCA_PIT_MAX_REJECTED_ATTEMPTS,
          ORCA_PIT_MAX_REJECTED_ATTEMPTS,
          nowMs,
          rejection.id
        )
      }
    })
  }

  /** Sent and finally refused events older than the retention window; pending ones always stay. */
  prune(nowMs: number): number {
    const cutoff = nowMs - ORCA_PIT_ACTIVITY_RETENTION_MS
    return Number(
      this.db
        .prepare(
          `DELETE FROM orca_pit_activity WHERE sent IN (${STATUS_SENT}, ${STATUS_REJECTED}) AND sent_at_ms < ?`
        )
        .run(cutoff).changes
    )
  }

  rejectionOf(id: string): { attempts: number; reason: string | null; final: boolean } | null {
    const row = this.db
      .prepare('SELECT attempts, reject_reason, sent FROM orca_pit_activity WHERE id = ?')
      .get(id)
    if (!row) {
      return null
    }
    return {
      attempts: int(row, 'attempts') ?? 0,
      reason: text(row, 'reject_reason'),
      final: int(row, 'sent') === STATUS_REJECTED
    }
  }

  /** Tokens already reported for a provider session, so a resumed one reports only the rest. */
  tokenBaseline(sessionId: string): { tokensIn: number; tokensOut: number } {
    const row = this.db
      .prepare('SELECT tokens_in, tokens_out FROM orca_pit_session_tokens WHERE session_id = ?')
      .get(sessionId)
    return {
      tokensIn: row ? (int(row, 'tokens_in') ?? 0) : 0,
      tokensOut: row ? (int(row, 'tokens_out') ?? 0) : 0
    }
  }

  saveTokenBaseline(sessionId: string, tokensIn: number, tokensOut: number): void {
    this.db
      .prepare(
        `INSERT INTO orca_pit_session_tokens (session_id, tokens_in, tokens_out) VALUES (?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET tokens_in = excluded.tokens_in, tokens_out = excluded.tokens_out`
      )
      .run(sessionId, tokensIn, tokensOut)
  }

  close(): void {
    this.db.close()
  }
}
