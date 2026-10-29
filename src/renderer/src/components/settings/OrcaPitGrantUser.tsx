// Orca-Pit: who signed in on an access grant through the DevNX Control login, and their role.
import type { RuntimeAccessGrant } from '../../../../shared/runtime-access-grants'
import { translate } from '@/i18n/i18n'

export function OrcaPitGrantUser({
  user
}: {
  user: NonNullable<RuntimeAccessGrant['orcaPitUser']>
}): React.JSX.Element {
  const role =
    user.orcaRole === 'admin'
      ? translate('devnx.access.roleAdmin', 'Administrator')
      : translate('devnx.access.roleMember', 'Member')
  return (
    <div className="text-muted-foreground truncate text-xs">
      {[user.name, role, user.email].filter(Boolean).join(' · ')}
    </div>
  )
}
