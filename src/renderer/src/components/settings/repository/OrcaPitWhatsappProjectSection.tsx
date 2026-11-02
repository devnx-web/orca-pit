// Orca-Pit: which WhatsApp group this project answers. The host that owns the project links the
// group to the project's DevNX Control project and to its own machine, where the group's chat
// will run. Needs the project linked in the Control first; admins choose, members see.
import { useEffect, useState } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import type { Repo } from '../../../../../shared/repo-types'
import type { OrcaPitWhatsappOverview } from '../../../../../shared/orca-pit-whatsapp'
import { devnxFailureText, useOrcaPitDevnxConnection } from '@/lib/orca-pit-devnx-status'
import {
  devnxTargetForRepo,
  devnxTargetKey,
  devnxTargetOfKey
} from '@/runtime/orca-pit-devnx-client'
import { orcaPitWhatsapp } from '@/runtime/orca-pit-whatsapp-client'
import { translate } from '@/i18n/i18n'
import { Button } from '../../ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/popover'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '../../ui/command'
import { SearchableSetting } from '../SearchableSetting'

type Loaded =
  | { status: 'loading' }
  | { status: 'hidden' }
  | { status: 'error'; error: string }
  | { status: 'ready'; overview: OrcaPitWhatsappOverview }

export function OrcaPitWhatsappProjectSection({
  repo,
  forceVisible
}: {
  repo: Repo
  forceVisible?: boolean
}): React.JSX.Element | null {
  const target = devnxTargetForRepo(repo)
  const targetKey = target ? devnxTargetKey(target) : null
  const connection = useOrcaPitDevnxConnection(target)
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' })
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!connection.connected || !targetKey) {
      return
    }
    let cancelled = false
    void orcaPitWhatsapp.overview(devnxTargetOfKey(targetKey)).then((result) => {
      if (cancelled) {
        return
      }
      if (result.ok) {
        setLoaded({ status: 'ready', overview: result.value })
      } else {
        setLoaded(
          result.code === 'not_connected'
            ? { status: 'hidden' }
            : { status: 'error', error: devnxFailureText(result) }
        )
      }
    })
    return () => {
      cancelled = true
    }
  }, [connection.connected, targetKey])

  if (!connection.connected || !targetKey || loaded.status === 'hidden') {
    return null
  }
  const label = translate('devnx.whatsappProject.title', 'WhatsApp group')
  const description = translate(
    'devnx.whatsappProject.description',
    'The agent of this project answers this group, on this machine, when someone of the team mentions @orca.'
  )
  const overview = loaded.status === 'ready' ? loaded.overview : null
  const projectId = repo.devnxControlProject?.id ?? null
  const machine = overview?.machine ?? null
  const linked =
    overview && machine && projectId !== null
      ? (overview.groups.find(
          (group) => group.project?.id === projectId && group.machine?.id === machine.id
        ) ?? null)
      : null
  const canChoose = connection.canLink && overview?.canManage === true
  const noneLabel = translate('devnx.whatsapp.notLinked', 'Not linked')

  const choose = async (groupId: number | null): Promise<void> => {
    setOpen(false)
    setSaving(true)
    setError(null)
    try {
      const result = await orcaPitWhatsapp.linkRepo(devnxTargetOfKey(targetKey), {
        repoId: repo.id,
        groupId
      })
      if (result.ok) {
        setLoaded({ status: 'ready', overview: result.value })
      } else {
        setError(devnxFailureText(result))
      }
    } finally {
      setSaving(false)
    }
  }

  let blocker: string | null = null
  if (overview && !overview.instance) {
    blocker = translate(
      'devnx.whatsappProject.noNumber',
      "The company's WhatsApp is not connected yet (Settings → Servers → WhatsApp)."
    )
  } else if (overview && projectId === null) {
    blocker = translate(
      'devnx.whatsappProject.needsProject',
      'Link this project to a DevNX Control project first (above).'
    )
  } else if (overview && !machine) {
    blocker = translate(
      'devnx.whatsappProject.needsMachine',
      'This machine must be approved under Company machines before it answers a group.'
    )
  }

  return (
    <SearchableSetting
      title={label}
      description={description}
      keywords={['whatsapp', 'group', 'orca', repo.displayName]}
      forceVisible={forceVisible}
      className="space-y-2"
    >
      <p className="text-sm font-semibold">{label}</p>
      <p className="text-xs text-muted-foreground">{description}</p>
      {loaded.status === 'loading' ? (
        <p className="text-xs text-muted-foreground">
          {translate('devnx.whatsapp.loading', 'Loading WhatsApp…')}
        </p>
      ) : null}
      {blocker ? <p className="text-xs text-muted-foreground">{blocker}</p> : null}
      {overview && !blocker && !canChoose ? (
        <>
          <p className="text-sm">{linked ? linked.name : noneLabel}</p>
          <p className="text-xs text-muted-foreground">
            {translate(
              'devnx.whatsappProject.adminOnly',
              'Only an administrator of the company in DevNX Control can change the group.'
            )}
          </p>
        </>
      ) : null}
      {overview && !blocker && canChoose ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              role="combobox"
              aria-label={label}
              aria-expanded={open}
              disabled={saving}
              className="w-full justify-between"
            >
              <span className="truncate">{linked ? linked.name : noneLabel}</span>
              <ChevronsUpDown className="size-4 shrink-0" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start">
            <Command>
              <CommandInput
                placeholder={translate('devnx.whatsappProject.search', 'Search groups')}
              />
              <CommandList>
                <CommandEmpty>
                  {translate(
                    'devnx.whatsappProject.empty',
                    'No groups. Sync them in Settings → Servers.'
                  )}
                </CommandEmpty>
                <CommandItem value={noneLabel} onSelect={() => void choose(null)}>
                  <span className="flex-1">{noneLabel}</span>
                  {!linked ? <Check className="size-4" /> : null}
                </CommandItem>
                {overview.groups.map((group) => (
                  <CommandItem
                    key={group.id}
                    value={`${group.name} ${group.id}`}
                    onSelect={() => void choose(group.id)}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{group.name}</span>
                      {group.project && group.id !== linked?.id ? (
                        <span className="block truncate text-xs text-muted-foreground">
                          {[group.project.name, group.machine?.name].filter(Boolean).join(' · ')}
                        </span>
                      ) : null}
                    </span>
                    {linked?.id === group.id ? <Check className="size-4" /> : null}
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      ) : null}
      {error || loaded.status === 'error' ? (
        <p role="alert" className="text-xs text-destructive">
          {error ?? (loaded.status === 'error' ? loaded.error : null)}
        </p>
      ) : null}
    </SearchableSetting>
  )
}
