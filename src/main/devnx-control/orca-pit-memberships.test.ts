import { describe, expect, it } from 'vitest'
import {
  orcaPitUserOfMe,
  parseOrcaPitMe,
  sharedOrcaPitUser,
  type OrcaPitMe
} from './orca-pit-memberships'

const PERSON = { id: 7, name: 'Fulano', email: 'f@x' }
// The owner works for DevNX (1) and Ailiv (2), DevNX by default.
const OWNER: OrcaPitMe = {
  id: 1,
  name: 'Dono',
  email: 'd@x',
  defaultTenantId: 1,
  tenants: [
    { id: 2, orcaRole: 'admin' },
    { id: 1, orcaRole: 'admin' }
  ]
}

function me(tenants: OrcaPitMe['tenants'], defaultTenantId = tenants[0].id): OrcaPitMe {
  return { ...PERSON, defaultTenantId, tenants }
}

describe('parseOrcaPitMe', () => {
  it('reads every membership from tenants', () => {
    const parsed = parseOrcaPitMe({
      user: PERSON,
      tenant: { id: 1, name: 'DEVNX' },
      orca_role: 'member',
      tenants: [
        { id: 1, name: 'DEVNX', role: 'programador', orca_role: 'member' },
        { id: 2, name: 'Ailiv', role: 'admin', orca_role: 'admin' },
        { id: 'x' }
      ]
    })
    expect(parsed).toEqual({
      ...PERSON,
      defaultTenantId: 1,
      tenants: [
        { id: 1, orcaRole: 'member' },
        { id: 2, orcaRole: 'admin' }
      ]
    })
  })

  it('falls back to tenant and orca_role from an older panel', () => {
    const parsed = parseOrcaPitMe({ user: PERSON, tenant: { id: 1 }, orca_role: 'owner' })
    expect(parsed.tenants).toEqual([{ id: 1, orcaRole: 'member' }])
    expect(parseOrcaPitMe({ user: PERSON, tenant: { id: 1 }, tenants: [] }).defaultTenantId).toBe(1)
    expect(() => parseOrcaPitMe({ user: { id: 7 } })).toThrow(/inválida/)
  })
})

describe('sharedOrcaPitUser', () => {
  it("accepts a person only in the owner's second company", () => {
    expect(sharedOrcaPitUser(me([{ id: 2, orcaRole: 'member' }]), OWNER)).toMatchObject({
      tenantId: 2,
      tenantIds: [2],
      orcaRole: 'member'
    })
  })

  it('refuses a person who shares no company', () => {
    expect(sharedOrcaPitUser(me([{ id: 3, orcaRole: 'admin' }]), OWNER)).toBeNull()
  })

  it('makes an admin of a person who administers any shared company, and only shared ones', () => {
    const both = me(
      [
        { id: 2, orcaRole: 'admin' },
        { id: 1, orcaRole: 'member' }
      ],
      2
    )
    // The owner's default comes first.
    expect(sharedOrcaPitUser(both, OWNER)).toMatchObject({
      tenantId: 1,
      tenantIds: [1, 2],
      orcaRole: 'admin'
    })
    const adminElsewhere = me([
      { id: 1, orcaRole: 'member' },
      { id: 3, orcaRole: 'admin' }
    ])
    expect(sharedOrcaPitUser(adminElsewhere, OWNER)).toMatchObject({
      tenantIds: [1],
      orcaRole: 'member'
    })
  })

  it('describes the owner with all of their companies, default first', () => {
    expect(orcaPitUserOfMe(OWNER)).toMatchObject({ id: 1, tenantId: 1, tenantIds: [1, 2] })
  })
})
