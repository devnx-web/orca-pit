// Orca-Pit: the company's WhatsApp groups as a table (photo, name, project, machine). Read-only:
// a group is linked from its project's settings, on the machine that will answer it.
import { Users } from 'lucide-react'
import type { OrcaPitWhatsappGroup } from '../../../../shared/orca-pit-whatsapp'
import { translate } from '@/i18n/i18n'

function GroupPhoto({ group }: { group: OrcaPitWhatsappGroup }): React.JSX.Element {
  return group.imageUrl ? (
    <img
      src={group.imageUrl}
      alt=""
      referrerPolicy="no-referrer"
      className="size-7 shrink-0 rounded-full object-cover"
    />
  ) : (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
      <Users className="size-3.5" aria-hidden />
    </span>
  )
}

export function OrcaPitWhatsappGroupsTable({
  groups
}: {
  groups: readonly OrcaPitWhatsappGroup[]
}): React.JSX.Element {
  if (groups.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {translate(
          'devnx.whatsapp.noGroups',
          'No groups yet. Sync to bring the groups this number is in.'
        )}
      </p>
    )
  }
  const notLinked = translate('devnx.whatsapp.notLinked', 'Not linked')
  return (
    <div className="overflow-x-auto rounded-lg border border-border/60">
      <table className="w-full text-xs">
        <thead className="bg-muted/30 text-left text-muted-foreground">
          <tr>
            <th className="w-10 px-3 py-2 font-medium">
              <span className="sr-only">{translate('devnx.whatsapp.photo', 'Photo')}</span>
            </th>
            <th className="px-3 py-2 font-medium">{translate('devnx.whatsapp.group', 'Group')}</th>
            <th className="px-3 py-2 font-medium">
              {translate('devnx.whatsapp.project', 'Project')}
            </th>
            <th className="px-3 py-2 font-medium">
              {translate('devnx.whatsapp.machine', 'Machine')}
            </th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <tr key={group.id} className="border-t border-border/40">
              <td className="px-3 py-1.5">
                <GroupPhoto group={group} />
              </td>
              <td className="max-w-64 px-3 py-1.5">
                <div className="truncate font-medium">{group.name}</div>
                {group.topic ? (
                  <div className="truncate text-muted-foreground">{group.topic}</div>
                ) : null}
              </td>
              <td className="max-w-48 truncate px-3 py-1.5">
                {group.project ? (
                  group.project.name
                ) : (
                  <span className="text-muted-foreground">{notLinked}</span>
                )}
              </td>
              <td className="max-w-48 truncate px-3 py-1.5">
                {group.machine ? (
                  group.machine.name
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
