// Orca-Pit: what a DevNX Control member may not do on the central Orca. Admins of the Control
// company keep every upstream permission; members work in workspaces but cannot change the
// machine, its settings, its accounts or its skills.
import type { RpcMethodPermission } from '../runtime/rpc/rpc-method-permission'

const MEMBER_DENIED: ReadonlySet<RpcMethodPermission> = new Set([
  'settings-write',
  'accounts-admin',
  'skills-admin',
  'host-admin'
])

/** The refusal for a member, or null when the role does not restrict this permission. */
export function denyForOrcaPitMember(
  methodName: string,
  permission: RpcMethodPermission
): string | null {
  return MEMBER_DENIED.has(permission)
    ? `Method '${methodName}' needs the '${permission}' permission, which only an administrator of the company in DevNX Control has.`
    : null
}
