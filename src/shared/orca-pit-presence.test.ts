import { describe, expect, it } from 'vitest'
import {
  deriveOrcaPitOnlineNow,
  otherViewers,
  parseOrcaPitHostPresence,
  type OrcaPitOnlineEntry
} from './orca-pit-presence'

const ana = { key: 'u:2', name: 'Ana Souza', userId: 2 }
const fabio = { key: 'u:1', name: 'Fabio', userId: 1 }

function online(
  person: typeof ana,
  device: string,
  since: number,
  central = false
): OrcaPitOnlineEntry {
  return { ...person, device, since, central }
}

describe('Orca-Pit presence reply', () => {
  it('moves the central stamps onto this client clock', () => {
    const presence = parseOrcaPitHostPresence(
      {
        authors: { 'tab:pane': { name: 'Ana', at: 1_000, userId: 2 } },
        online: [online(ana, 'Ana · navegador', 500)],
        now: 2_000
      },
      12_000
    )
    expect(presence.authors['tab:pane']).toEqual({ name: 'Ana', at: 11_000, userId: 2 })
    expect(presence.online[0]?.since).toBe(10_500)
  })

  it('reads an older central that only sends authors, and drops malformed people', () => {
    const presence = parseOrcaPitHostPresence(
      {
        authors: {},
        viewers: { 'tab:pane': [ana, { key: '', name: 'x' }, 'nope'], empty: [] },
        starters: { 'tab:pane': fabio, bad: { name: 'no key' } },
        self: { key: 'u:1', name: 'Fabio', userId: 1 },
        machineName: 'central-devnx'
      },
      0
    )
    expect(presence.viewers).toEqual({ 'tab:pane': [ana] })
    expect(presence.starters).toEqual({ 'tab:pane': fabio })
    expect(presence.self).toEqual(fabio)
    expect(presence.machineName).toBe('central-devnx')
    expect(parseOrcaPitHostPresence({ authors: {} }, 0).online).toEqual([])
    expect(parseOrcaPitHostPresence(null, 0).self).toBeNull()
  })

  it('leaves the reader out of a pane viewers', () => {
    expect(otherViewers([ana, fabio], new Set(['u:1']))).toEqual([ana])
    expect(otherViewers(undefined, new Set())).toEqual([])
  })
})

describe('Orca-Pit online now', () => {
  it('is hidden while only one person is around', () => {
    expect(deriveOrcaPitOnlineNow([{ online: [online(fabio, '', 10, true)] }])).toEqual([])
    expect(
      deriveOrcaPitOnlineNow([
        { online: [online(fabio, '', 10, true), online(fabio, 'Notebook', 20)] }
      ])
    ).toEqual([])
  })

  it('merges a person across devices and hosts, earliest first', () => {
    const people = deriveOrcaPitOnlineNow([
      { online: [online(fabio, '', 30, true), online(ana, 'Ana · navegador', 50)] },
      { online: [online(ana, 'Ana · celular', 20), online(ana, 'Ana · navegador', 50)] }
    ])
    expect(people.map((person) => person.key)).toEqual(['u:2', 'u:1'])
    expect(people[0]).toMatchObject({ name: 'Ana Souza', since: 20 })
    expect(people[0]?.devices.map((device) => device.device)).toEqual([
      'Ana · celular',
      'Ana · navegador'
    ])
    expect(people[1]?.devices).toEqual([{ device: '', since: 30, central: true }])
  })
})
