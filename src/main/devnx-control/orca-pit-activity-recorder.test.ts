import { describe, expect, it, vi } from 'vitest'
import type { AgentStatusIpcPayload } from '../../shared/agent-status-ipc-payload'
import type { AgentHookStatusRowMutation } from '../agent-hooks/server/server-types'
import type { OrcaPitActor } from './orca-pit-activity-context'

const OWNER: OrcaPitActor = {
  userId: 12,
  name: 'Fabio Dono',
  deviceLabel: 'Fabio Dono · app',
  localActor: true,
  programmatic: false
}

vi.mock('./orca-pit-activity-context', () => ({
  actorForCaller: () => OWNER,
  firstName: (name: string | null) => name?.trim().split(/\s+/)[0] || null,
  workspaceContext: (worktreeId: string | null) => ({
    orca_project: worktreeId ? 'soulog' : null,
    workspace: worktreeId ? 'relatorio-sac' : null,
    project_id: worktreeId ? 24 : null,
    task_id: worktreeId ? 311 : null
  })
}))

import { OrcaPitAgentTracker, type OrcaPitAgentStatusSource } from './orca-pit-activity-agents'
import type { OrcaPitActivityDb } from './orca-pit-activity-db'
import { OrcaPitActivityRecorder } from './orca-pit-activity-recorder'
import type { OrcaPitActivityDraft } from './orca-pit-activity-types'

const FULANO: OrcaPitActor = {
  userId: 7,
  name: 'Fulano de Tal',
  deviceLabel: 'Fulano de Tal · navegador',
  localActor: false,
  programmatic: false
}
const TARGET = { paneKey: 'tab-1:pane', worktreeId: 'repo::/w/relatorio-sac' }

function recorderWithDb(agentPanes: Record<string, { agent: string; sessionId: string }> = {}) {
  const inserted: OrcaPitActivityDraft[] = []
  const db = { insert: (drafts: OrcaPitActivityDraft[]) => inserted.push(...drafts) }
  const recorder = new OrcaPitActivityRecorder(() => 1_000)
  recorder.attach(db as unknown as OrcaPitActivityDb, (paneKey) => agentPanes[paneKey] ?? null)
  return { recorder, inserted }
}

describe('Orca-Pit recorder', () => {
  it('records a terminal line only on Enter, signed and placed', () => {
    const { recorder, inserted } = recorderWithDb()
    const resolveTarget = vi.fn(() => TARGET)
    for (const key of 'npm test') {
      recorder.observeTerminalInput('pty-1', key, FULANO, resolveTarget)
    }
    recorder.flush()
    expect(inserted).toHaveLength(0)
    expect(resolveTarget).not.toHaveBeenCalled()
    recorder.observeTerminalInput('pty-1', '\r', FULANO, resolveTarget)
    recorder.flush()
    expect(inserted).toEqual([
      expect.objectContaining({
        action: 'terminal_line',
        detail: 'npm test',
        user_id: 7,
        device_label: 'Fulano de Tal · navegador',
        orca_project: 'soulog',
        workspace: 'relatorio-sac',
        project_id: 24,
        task_id: 311
      })
    ])
  })

  it('hides the password typed after sudo, then records normally again', () => {
    const { recorder, inserted } = recorderWithDb()
    recorder.observeTerminalInput('pty-1', 'sudo systemctl restart nginx\r', FULANO, () => TARGET)
    recorder.observeTerminalInput('pty-1', 'cavalo-azul\r', FULANO, () => TARGET)
    recorder.observeTerminalInput('pty-1', 'ls\r', FULANO, () => TARGET)
    recorder.flush()
    expect(inserted.map((draft) => draft.detail)).toEqual([
      'sudo systemctl restart nginx',
      '[oculto]',
      'ls'
    ])
  })

  it('turns a line typed into a running agent into an agent message', () => {
    const { recorder, inserted } = recorderWithDb({
      'tab-1:pane': { agent: 'claude', sessionId: 'c1f' }
    })
    recorder.observeTerminalInput('pty-1', 'corrija o teste\r', FULANO, () => TARGET)
    recorder.flush()
    expect(inserted[0]).toMatchObject({
      action: 'agent_message',
      agent: 'claude',
      session_id: 'c1f'
    })
  })

  it('remembers who drove each pane, but not the agents behind the CLI', () => {
    const { recorder } = recorderWithDb()
    recorder.observeTerminalInput('pty-1', 'oi\r', FULANO, () => TARGET)
    recorder.observeTerminalInput('pty-2', 'oi\r', { ...OWNER, programmatic: true }, () => ({
      paneKey: 'tab-2:pane',
      worktreeId: null
    }))
    expect(recorder.authorsByPane()).toEqual({
      'tab-1:pane': { name: 'Fulano', at: 1_000, userId: FULANO.userId }
    })
    expect(recorder.actorForPane('tab-1:pane')).toBe(FULANO)
    expect(recorder.actorForPane('tab-2:pane')).toBe(OWNER)
  })
})

describe('Orca-Pit agent start/stop', () => {
  function statusSource(rows: Map<string, AgentStatusIpcPayload>) {
    let listener: ((mutation: AgentHookStatusRowMutation) => void) | null = null
    const source: OrcaPitAgentStatusSource = {
      getStatusSnapshot: () => [...rows.values()],
      getStatusSnapshotForPane: (paneKey) => (rows.has(paneKey) ? [rows.get(paneKey)!] : []),
      subscribeStatusRowMutations: (next) => {
        listener = next
        return () => {
          listener = null
        }
      }
    }
    return { source, emit: (mutation: AgentHookStatusRowMutation) => listener?.(mutation) }
  }

  it('reports start and stop with the tokens of the provider session', async () => {
    const rows = new Map<string, AgentStatusIpcPayload>()
    const { source, emit } = statusSource(rows)
    const recorded: OrcaPitActivityDraft[] = []
    const tracker = new OrcaPitAgentTracker({
      record: (draft) => recorded.push(draft),
      actorForPane: () => FULANO,
      tokensForStop: async () => ({ tokensIn: 1200, tokensOut: 340 }),
      now: () => 5_000
    })
    tracker.attach(source)
    rows.set('tab-1:pane', {
      paneKey: 'tab-1:pane',
      agentType: 'claude',
      worktreeId: TARGET.worktreeId,
      providerSession: { key: 'session_id', id: 'prov-1' }
    } as AgentStatusIpcPayload)
    emit({ before: null, after: { paneKey: 'tab-1:pane' } })
    tracker.flush()
    expect(tracker.agentForPane('tab-1:pane')).toEqual({ agent: 'claude', sessionId: 'prov-1' })
    // The sidebar's "Mine" counts whoever started the agent.
    expect(tracker.startersByPane()).toEqual({
      'tab-1:pane': { key: 'u:7', name: 'Fulano de Tal', userId: 7 }
    })
    rows.delete('tab-1:pane')
    emit({ before: { paneKey: 'tab-1:pane' }, after: null })
    tracker.flush()
    await vi.waitFor(() => expect(recorded).toHaveLength(2))
    expect(recorded[0]).toMatchObject({
      action: 'agent_started',
      user_id: 7,
      session_id: 'prov-1',
      agent: 'claude',
      project_id: 24
    })
    expect(recorded[1]).toMatchObject({
      action: 'agent_stopped',
      session_id: 'prov-1',
      tokens_in: 1200,
      tokens_out: 340
    })
    tracker.detach()
  })
})
