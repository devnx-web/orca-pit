import { describe, expect, it } from 'vitest'
import type { OrcaPitMachine } from '../../../../shared/orca-pit-machines'
import {
  isOrcaPitMachineOutdated,
  orcaPitMachineRowAction,
  sortOrcaPitMachines
} from './orca-pit-company-machines'

function machine(overrides: Partial<OrcaPitMachine>): OrcaPitMachine {
  return {
    id: 1,
    tenant: { id: 1, name: 'DEVNX' },
    owner: { id: 1, name: 'Fabio', avatarUrl: null },
    name: 'Nitro5',
    slug: 'nitro5',
    status: 'approved',
    private: false,
    platform: null,
    version: '1.4.214-pit14',
    online: true,
    lastSeenAt: null,
    publicUrl: 'wss://orca.devnx.com.br/nitro5',
    webUrl: null,
    lanEndpoints: [],
    isMine: false,
    canManage: false,
    originHost: null,
    ...overrides
  }
}

const IDLE = { kind: 'idle' } as const

describe('orcaPitMachineRowAction', () => {
  it('marks this computer by its own directory entry', () => {
    const self = {
      kind: 'registered',
      machine: machine({ id: 4 }),
      tunnel: { kind: 'off' }
    } as const
    expect(orcaPitMachineRowAction(machine({ id: 4 }), self, [])).toEqual({ kind: 'this-computer' })
  })

  it('offers Connect only to an approved machine that is online and not saved yet', () => {
    expect(orcaPitMachineRowAction(machine({}), IDLE, [])).toEqual({ kind: 'connect' })
    expect(orcaPitMachineRowAction(machine({ online: false }), IDLE, [])).toEqual({
      kind: 'offline'
    })
    expect(orcaPitMachineRowAction(machine({ status: 'pending' }), IDLE, [])).toEqual({
      kind: 'pending'
    })
    expect(
      orcaPitMachineRowAction(machine({}), IDLE, [
        { id: 'env-1', endpoints: [{ endpoint: 'wss://orca.devnx.com.br/nitro5/' }] }
      ])
    ).toEqual({ kind: 'saved', environmentId: 'env-1' })
  })
})

describe('machine list', () => {
  it('flags a machine behind the newest release in the company', () => {
    const list = [machine({ id: 1, version: '1.4.214-pit9' }), machine({ id: 2 })]
    expect(isOrcaPitMachineOutdated(list[0], list)).toBe(true)
    expect(isOrcaPitMachineOutdated(list[1], list)).toBe(false)
  })

  it('puts this computer first, then online machines, then by name', () => {
    const list = [
      machine({ id: 1, name: 'Zeta', online: false }),
      machine({ id: 2, name: 'Beta' }),
      machine({ id: 3, name: 'Alfa' }),
      machine({ id: 4, name: 'Mirella', online: false })
    ]
    expect(sortOrcaPitMachines(list, 4).map((entry) => entry.name)).toEqual([
      'Mirella',
      'Alfa',
      'Beta',
      'Zeta'
    ])
  })
})
