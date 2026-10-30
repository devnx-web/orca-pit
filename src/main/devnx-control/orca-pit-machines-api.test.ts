import { describe, expect, it } from 'vitest'
import { parseOrcaPitMachine } from './orca-pit-machines-api'

describe('parseOrcaPitMachine', () => {
  it('reads the Control machine (contrato v1.2)', () => {
    expect(
      parseOrcaPitMachine({
        id: 3,
        tenant: { id: 1, name: 'DEVNX' },
        owner: { id: 7, name: 'Ana', avatar_url: 'https://s3.test/ana.png' },
        name: 'Mirella',
        slug: 'mirella',
        status: 'approved',
        private: true,
        platform: 'win32-x64',
        version: '1.4.214-pit14',
        online: true,
        last_seen_at: '2026-10-30T22:00:00Z',
        public_url: 'https://orca.devnx.com.br/mirella/',
        ws_url: 'wss://orca.devnx.com.br/mirella',
        lan_endpoints: ['ws://192.168.0.5:6768', 7],
        is_mine: false,
        can_manage: true,
        origin_host: 'orca-mirella-0a1b2c.devnx.com.br'
      })
    ).toEqual({
      id: 3,
      tenant: { id: 1, name: 'DEVNX' },
      owner: { id: 7, name: 'Ana', avatarUrl: 'https://s3.test/ana.png' },
      name: 'Mirella',
      slug: 'mirella',
      status: 'approved',
      private: true,
      platform: 'win32-x64',
      version: '1.4.214-pit14',
      online: true,
      lastSeenAt: '2026-10-30T22:00:00Z',
      publicUrl: 'wss://orca.devnx.com.br/mirella',
      webUrl: 'https://orca.devnx.com.br/mirella/',
      lanEndpoints: ['ws://192.168.0.5:6768'],
      isMine: false,
      canManage: true,
      originHost: 'orca-mirella-0a1b2c.devnx.com.br'
    })
  })

  it('rejects an entry without what a row needs', () => {
    expect(parseOrcaPitMachine({ id: 3, slug: 'x', status: 'weird' })).toBeNull()
    expect(parseOrcaPitMachine(null)).toBeNull()
  })
})
