import { afterEach, describe, expect, it } from 'vitest'
import {
  checkManagedOrigin,
  routedClientAddress,
  setOrcaPitManagedOrigin
} from './orca-pit-managed-origin'

const HOST = 'orca-nitro5-a1b2c3.devnx.com.br'

afterEach(() => {
  setOrcaPitManagedOrigin(null)
})

describe('managed origin', () => {
  it('lets the router in on the hidden hostname and trusts the IP it names', () => {
    setOrcaPitManagedOrigin({ host: HOST, secret: 'segredo' })
    const headers = {
      host: 'ORCA-NITRO5-A1B2C3.devnx.com.br:443',
      'x-orca-origin-secret': 'segredo',
      'x-orca-client-ip': ' 203.0.113.7 '
    }
    expect(checkManagedOrigin(headers)).toBe('router')
    expect(routedClientAddress(headers)).toBe('203.0.113.7')
  })

  it('refuses the hidden hostname with a wrong or missing secret', () => {
    setOrcaPitManagedOrigin({ host: HOST, secret: 'segredo' })
    expect(checkManagedOrigin({ host: HOST, 'x-orca-origin-secret': 'segred' })).toBe('refused')
    expect(checkManagedOrigin({ host: HOST })).toBe('refused')
    expect(routedClientAddress({ host: HOST, 'x-orca-client-ip': '1.2.3.4' })).toBeNull()
  })

  it('leaves every other hostname alone and never trusts its forwarded IP', () => {
    setOrcaPitManagedOrigin({ host: HOST, secret: 'segredo' })
    const lan = { host: '192.168.15.22:6768', 'x-orca-client-ip': '1.2.3.4' }
    expect(checkManagedOrigin(lan)).toBe('other-host')
    expect(routedClientAddress({ ...lan, 'x-orca-origin-secret': 'segredo' })).toBeNull()
  })

  it('is off until the Control hands over a host and a secret', () => {
    expect(checkManagedOrigin({ host: HOST })).toBe('other-host')
    setOrcaPitManagedOrigin({ host: HOST, secret: '' })
    expect(checkManagedOrigin({ host: HOST })).toBe('other-host')
  })

  it('refuses a routed IP that is not an address', () => {
    setOrcaPitManagedOrigin({ host: HOST, secret: 'segredo' })
    expect(
      routedClientAddress({
        host: HOST,
        'x-orca-origin-secret': 'segredo',
        'x-orca-client-ip': 'a b'
      })
    ).toBeNull()
  })
})
