import { describe, expect, it } from 'vitest'
import { orcaPitRowPeople, orcaPitRowPeopleTitle } from './orca-pit-row-people'

const words = {
  viewing: (name: string) => `${name} (olhando agora)`,
  lastCommand: (name: string, age: string) => `${name} (último comando há ${age})`,
  lastCommandNow: (name: string) => `${name} (último comando agora)`,
  both: (name: string, age: string) => `${name} (olhando agora, último comando há ${age})`,
  bothNow: (name: string) => `${name} (olhando agora, último comando agora)`,
  nowWord: 'agora'
}
const fabio = { key: 'u:1', name: 'Fabio', userId: 1 }
const ana = { key: 'u:2', name: 'Ana', userId: 2 }
const NOW = 10 * 60_000

describe('Orca-Pit: people on an agent row', () => {
  it('lists the last author first and each person once', () => {
    const people = orcaPitRowPeople([fabio, ana], { name: 'Ana', at: NOW - 3 * 60_000, userId: 2 })
    expect(people.map((person) => person.key)).toEqual(['u:2', 'u:1'])
    expect(orcaPitRowPeopleTitle(people, NOW, words)).toBe(
      'Ana (olhando agora, último comando há 3m) · Fabio (olhando agora)'
    )
  })

  it('keeps yourself when you are the only one on it', () => {
    expect(orcaPitRowPeople([fabio], null)).toEqual([
      { key: 'u:1', name: 'Fabio', viewing: true, lastCommandAt: null }
    ])
  })

  it('names an author who is not looking, and a command sent just now', () => {
    const people = orcaPitRowPeople([], { name: 'Ana', at: NOW, userId: 2 })
    expect(orcaPitRowPeopleTitle(people, NOW, words)).toBe('Ana (último comando agora)')
  })

  it('has nobody without viewers or an author', () => {
    expect(orcaPitRowPeople(undefined, null)).toEqual([])
  })
})
