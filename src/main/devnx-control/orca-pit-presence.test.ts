import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ powerMonitor: {} }))

import { buildOrcaPitPresence } from './orca-pit-presence'
import {
  forgetOrcaPitConnection,
  liveOrcaPitConnections,
  noteOrcaPitConnection,
  resetOrcaPitPresenceRegistryForTest,
  trackOrcaPitMultiplex,
  viewedOrcaPitPtys,
  type OrcaPitMultiplexView
} from './orca-pit-presence-registry'

const ana = { key: 'u:2', name: 'Ana', userId: 2 }
const fabio = { key: 'u:1', name: 'Fabio', userId: 1 }

function multiplex(streams: [string, boolean][]): OrcaPitMultiplexView {
  return {
    closed: false,
    streams: new Map(streams.map(([ptyId, outputPaused], i) => [i, { ptyId, outputPaused }]))
  }
}

afterEach(() => resetOrcaPitPresenceRegistryForTest())

describe('Orca-Pit presence on the central', () => {
  it('names each viewer once per pane, the owner included on the pane the window shows', () => {
    const presence = buildOrcaPitPresence({
      self: ana,
      viewed: [
        { paneKey: 'tab:a', person: ana },
        { paneKey: 'tab:a', person: ana },
        { paneKey: null, person: ana }
      ],
      connections: [{ person: ana, device: 'Ana · navegador', since: 5 }],
      owner: { person: fabio, since: 3, activePaneKey: 'tab:a' },
      machineName: 'central',
      now: 9
    })
    expect(presence.viewers).toEqual({ 'tab:a': [ana, fabio] })
    expect(presence.online).toEqual([
      { ...ana, device: 'Ana · navegador', since: 5, central: false },
      { ...fabio, device: '', since: 3, central: true }
    ])
    expect(presence).toMatchObject({ self: ana, machineName: 'central', now: 9 })
  })

  it('leaves the owner out when nobody is at the machine', () => {
    const presence = buildOrcaPitPresence({
      self: fabio,
      viewed: [],
      connections: [],
      owner: null,
      machineName: 'central',
      now: 1
    })
    expect(presence.viewers).toEqual({})
    expect(presence.online).toEqual([])
  })

  it('counts a remote pane as viewed only while its stream is unpaused and open', () => {
    const device = { kind: 'paired-device', deviceId: 'dev-ana' } as const
    const open = multiplex([
      ['pty-shown', false],
      ['pty-hidden', true]
    ])
    const closed = multiplex([['pty-old', false]])
    trackOrcaPitMultiplex(open, device)
    trackOrcaPitMultiplex(closed, device)
    // Agents drive terminals through the local CLI; they are nobody looking.
    trackOrcaPitMultiplex(multiplex([['pty-cli', false]]), { kind: 'local-cli' })
    closed.closed = true
    expect(viewedOrcaPitPtys()).toEqual([{ ptyId: 'pty-shown', caller: device }])
  })

  it('keeps one entry per live socket until it closes', () => {
    noteOrcaPitConnection('c1', 'dev-ana', 10)
    noteOrcaPitConnection('c1', 'dev-ana', 20)
    noteOrcaPitConnection('c2', 'dev-bruno', 30)
    forgetOrcaPitConnection('c2')
    expect(liveOrcaPitConnections()).toEqual([{ deviceId: 'dev-ana', since: 10 }])
  })
})
