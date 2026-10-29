import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./orca-pit-activity-control', () => ({
  ORCA_PIT_ACTIVITY_API_PATHS: { me: '/api/orca/me', ingest: '/api/orca/activity/ingest' }
}))

import {
  ORCA_PIT_ACTIVITY_RETENTION_MS,
  ORCA_PIT_MAX_REJECTED_ATTEMPTS,
  OrcaPitActivityDb
} from './orca-pit-activity-db'
import { DevnxControlError } from './devnx-control-http'
import { OrcaPitActivitySender, parseIngestResult } from './orca-pit-activity-sender'
import type { OrcaPitActivityDraft, OrcaPitActivityEvent } from './orca-pit-activity-types'

const CONNECTION = {
  baseUrl: 'https://control.test',
  deviceToken: 'central',
  source: 'orca' as const
}
const NOW = Date.UTC(2026, 9, 29, 17, 3, 11)

function draft(overrides: Partial<OrcaPitActivityDraft> = {}): OrcaPitActivityDraft {
  return {
    action: 'terminal_line',
    user_id: 7,
    device_label: 'Fulano · navegador',
    project_id: null,
    task_id: null,
    orca_project: 'soulog',
    workspace: 'relatorio-sac',
    session_id: null,
    agent: null,
    tokens_in: null,
    tokens_out: null,
    detail: 'git status',
    atMs: NOW,
    localActor: false,
    ...overrides
  }
}

type Post = (base: string, path: string, options: { body?: unknown }) => Promise<unknown>

function sentEvents(post: ReturnType<typeof vi.fn<Post>>, call = 0): OrcaPitActivityEvent[] {
  const body = post.mock.calls[call]?.[2].body as { events: OrcaPitActivityEvent[] }
  return body.events
}

describe('Orca-Pit activity diary and sender', () => {
  let dir: string
  let db: OrcaPitActivityDb

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'orca-pit-activity-'))
    db = new OrcaPitActivityDb(join(dir, 'orca-pit-activity.db'))
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  function sender(post: Post, owner: { id: number } | null = null): OrcaPitActivitySender {
    return new OrcaPitActivitySender({
      db,
      connection: () => CONNECTION,
      owner: async () =>
        owner ? { ...owner, name: 'Dono', email: '', tenantId: 1, orcaRole: 'admin' } : null,
      post: post as never,
      deviceUid: 'pc-central',
      now: () => NOW
    })
  }

  it('stores events with ULID ids and -03:00 timestamps in the contract shape', () => {
    const [id] = db.insert([draft()])
    const [event] = db.pending(10)
    expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(event).toMatchObject({
      id,
      user_id: 7,
      action: 'terminal_line',
      at: '2026-10-29T14:03:11-03:00'
    })
  })

  it('sends in batches of at most 500 and marks accepted and duplicates as sent', async () => {
    db.insert(Array.from({ length: 700 }, (_, index) => draft({ atMs: NOW + index })))
    const post = vi.fn<Post>(async (_base, _path, options) => {
      const events = (options.body as { events: unknown[] }).events
      return { accepted: events.length - 2, duplicates: 2, rejected: [] }
    })
    await sender(post).sendNow()
    expect(post).toHaveBeenCalledTimes(2)
    expect(post.mock.calls[0]?.[1]).toBe('/api/orca/activity/ingest')
    expect(post.mock.calls[0]?.[2].body).toMatchObject({ device_uid: 'pc-central' })
    expect(sentEvents(post, 0)).toHaveLength(500)
    expect(sentEvents(post, 1)).toHaveLength(200)
    expect(db.pending(1000)).toHaveLength(0)
  })

  it('keeps everything pending on a network failure', async () => {
    db.insert([draft(), draft()])
    const post = vi.fn<Post>(async () => {
      throw new DevnxControlError('offline', { code: 'NETWORK_ERROR' })
    })
    await sender(post).sendNow()
    expect(db.pending(10)).toHaveLength(2)
  })

  it('keeps everything pending when the reply does not account for the batch', async () => {
    db.insert([draft(), draft()])
    await sender(vi.fn<Post>(async () => ({}))).sendNow()
    expect(db.pending(10)).toHaveLength(2)
  })

  it('keeps a refused event with its reason and gives up after the last attempt', async () => {
    const [good, bad] = db.insert([draft(), draft({ user_id: 99, atMs: NOW + 1 })])
    const post = vi.fn<Post>(async (_base, _path, options) => {
      const events = (options.body as { events: OrcaPitActivityEvent[] }).events
      const refused = events.filter((event) => event.id === bad)
      return {
        accepted: events.length - refused.length,
        duplicates: 0,
        rejected: refused.map(() => ({
          index: events.findIndex((e) => e.id === bad),
          id: null,
          reason: 'usuário de outra empresa'
        }))
      }
    })
    const instance = sender(post)
    await instance.sendNow()
    expect(db.pending(10).map((event) => event.id)).toEqual([bad])
    expect(db.rejectionOf(bad!)).toEqual({
      attempts: 1,
      reason: 'usuário de outra empresa',
      final: false
    })
    for (let attempt = 1; attempt < ORCA_PIT_MAX_REJECTED_ATTEMPTS; attempt += 1) {
      await instance.sendNow()
    }
    expect(db.rejectionOf(bad!)).toMatchObject({
      attempts: ORCA_PIT_MAX_REJECTED_ATTEMPTS,
      final: true
    })
    expect(db.pending(10)).toHaveLength(0)
    expect(db.rejectionOf(good!)).toMatchObject({ attempts: 0, final: false })
  })

  it('stamps the central owner on local events before sending', async () => {
    db.insert([draft({ user_id: null, localActor: true }), draft({ user_id: null, atMs: NOW + 1 })])
    const post = vi.fn<Post>(async () => ({ accepted: 2, duplicates: 0, rejected: [] }))
    await sender(post, { id: 12 }).sendNow()
    expect(sentEvents(post).map((event) => event.user_id)).toEqual([12, null])
  })

  it('does nothing without the central Control session', async () => {
    db.insert([draft()])
    const post = vi.fn<Post>()
    await new OrcaPitActivitySender({
      db,
      connection: () => null,
      owner: async () => null,
      post: post as never
    }).sendNow()
    expect(post).not.toHaveBeenCalled()
  })

  it('prunes sent events after 90 days but never pending ones', () => {
    const [old, recent, pending] = db.insert([
      draft(),
      draft({ atMs: NOW + 1 }),
      draft({ atMs: NOW + 2 })
    ])
    db.markSent([old!], NOW - ORCA_PIT_ACTIVITY_RETENTION_MS - 1)
    db.markSent([recent!], NOW - ORCA_PIT_ACTIVITY_RETENTION_MS + 60_000)
    expect(db.prune(NOW)).toBe(1)
    expect(db.rejectionOf(old!)).toBeNull()
    expect(db.rejectionOf(recent!)).not.toBeNull()
    expect(db.pending(10).map((event) => event.id)).toEqual([pending])
  })

  it('reports only the tokens a resumed session added since its last stop', () => {
    expect(db.tokenBaseline('s1')).toEqual({ tokensIn: 0, tokensOut: 0 })
    db.saveTokenBaseline('s1', 1200, 340)
    expect(db.tokenBaseline('s1')).toEqual({ tokensIn: 1200, tokensOut: 340 })
  })

  it('maps a refusal without id to the event at its batch index', () => {
    const batch = [{ id: 'A' }, { id: 'B' }] as OrcaPitActivityEvent[]
    expect(
      parseIngestResult({ accepted: 1, rejected: [{ index: 1, id: null, reason: 'x' }] }, batch)
    ).toEqual({
      accepted: 1,
      duplicates: 0,
      rejected: [{ id: 'B', reason: 'x' }]
    })
  })
})
