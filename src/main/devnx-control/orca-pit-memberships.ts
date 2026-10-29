// Orca-Pit: the companies a Control user belongs to. In the panel's "Todas as empresas" mode one
// person works for several companies at once, so /api/orca/me lists every active membership in
// `tenants`; older panels send only the default `tenant` and `orca_role`. A person may use the
// central Orca when they share at least one company with the owner of its Control session.
import { DevnxControlError, isRecord } from './devnx-control-http'
import type { OrcaPitUser } from './orca-pit-identity-types'

export type OrcaPitMembership = { id: number; orcaRole: OrcaPitUser['orcaRole'] }

/** One `/api/orca/me` answer: the person, their default company and every membership. */
export type OrcaPitMe = {
  id: number
  name: string
  email: string
  defaultTenantId: number
  tenants: OrcaPitMembership[]
}

function positiveInteger(value: unknown): number | null {
  const number = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  return typeof number === 'number' && Number.isSafeInteger(number) && number > 0 ? number : null
}

function membershipOf(tenant: unknown, orcaRole: unknown): OrcaPitMembership | null {
  const id = isRecord(tenant) ? positiveInteger(tenant.id) : null
  return id === null ? null : { id, orcaRole: orcaRole === 'admin' ? 'admin' : 'member' }
}

function invalid(): DevnxControlError {
  return new DevnxControlError('Resposta inválida do DevNX Control em /api/orca/me.', {
    code: 'INVALID_SERVER_RESPONSE'
  })
}

export function parseOrcaPitMe(payload: unknown): OrcaPitMe {
  if (!isRecord(payload) || !isRecord(payload.user)) {
    throw invalid()
  }
  const id = positiveInteger(payload.user.id)
  const fallback = membershipOf(payload.tenant, payload.orca_role)
  const listed = Array.isArray(payload.tenants)
    ? payload.tenants.map((tenant) => membershipOf(tenant, isRecord(tenant) && tenant.orca_role))
    : []
  const tenants = new Map<number, OrcaPitMembership>()
  for (const membership of listed) {
    if (membership && !tenants.has(membership.id)) {
      tenants.set(membership.id, membership)
    }
  }
  // An older panel has no `tenants`; its default company is the only one we know.
  if (tenants.size === 0 && fallback) {
    tenants.set(fallback.id, fallback)
  }
  const defaultTenantId = fallback?.id ?? tenants.keys().next().value ?? null
  if (id === null || defaultTenantId === null) {
    throw invalid()
  }
  return {
    id,
    name: typeof payload.user.name === 'string' ? payload.user.name.slice(0, 120) : '',
    email: typeof payload.user.email === 'string' ? payload.user.email.slice(0, 254) : '',
    defaultTenantId,
    tenants: [...tenants.values()]
  }
}

function userOf(me: OrcaPitMe, memberships: OrcaPitMembership[], tenantId: number): OrcaPitUser {
  const tenantIds = [tenantId, ...memberships.map((m) => m.id).filter((id) => id !== tenantId)]
  return {
    id: me.id,
    name: me.name,
    email: me.email,
    tenantId,
    tenantIds,
    orcaRole: memberships.some((m) => m.orcaRole === 'admin') ? 'admin' : 'member'
  }
}

/** The owner of the central session as a person: all of their companies. */
export function orcaPitUserOfMe(me: OrcaPitMe): OrcaPitUser {
  return userOf(me, me.tenants, me.defaultTenantId)
}

/**
 * The person as seen by this central Orca: only the companies shared with its owner, the owner's
 * default first, and admin when they administer any of them. Null when they share none.
 */
export function sharedOrcaPitUser(me: OrcaPitMe, central: OrcaPitMe): OrcaPitUser | null {
  const centralIds = new Set(central.tenants.map((tenant) => tenant.id))
  const shared = me.tenants.filter((tenant) => centralIds.has(tenant.id))
  if (shared.length === 0) {
    return null
  }
  const preferred = shared.some((tenant) => tenant.id === central.defaultTenantId)
    ? central.defaultTenantId
    : shared[0].id
  return userOf(me, shared, preferred)
}
