// Orca-Pit: links this Orca project to a DevNX Control project, chosen by hand. The project
// whose repository matches a git remote (or, failing that, whose name is alike) is highlighted.
import { useEffect, useState } from 'react'
import { Check, ChevronsUpDown, Sparkles } from 'lucide-react'
import type { Repo } from '../../../../../shared/repo-types'
import type {
  DevnxControlProjectList,
  DevnxControlProjectReference
} from '../../../../../shared/orca-pit-devnx-tasks'
import { getRepoExecutionHostId } from '../../../../../shared/execution-host'
import { useAppStore } from '@/store/index'
import { orcaPitDevnxApi, useOrcaPitDevnxConnection } from '@/lib/orca-pit-devnx-status'
import { Button } from '../../ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/popover'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '../../ui/command'
import { SearchableSetting } from '../SearchableSetting'
import { translate } from '@/i18n/i18n'

type ProjectsState =
  | { status: 'loading' }
  | { status: 'ready'; list: DevnxControlProjectList }
  | { status: 'error'; error: string }

function useControlProjects(repoId: string, enabled: boolean): ProjectsState {
  const [state, setState] = useState<ProjectsState>({ status: 'loading' })
  useEffect(() => {
    const api = orcaPitDevnxApi()
    if (!enabled || !api) {
      return
    }
    let cancelled = false
    setState({ status: 'loading' })
    void api.listProjects({ repoId }).then(
      (result) => {
        if (!cancelled) {
          setState(
            result.ok
              ? { status: 'ready', list: result.value }
              : { status: 'error', error: result.error }
          )
        }
      },
      (error: unknown) => {
        if (!cancelled) {
          setState({ status: 'error', error: String(error) })
        }
      }
    )
    return () => {
      cancelled = true
    }
  }, [enabled, repoId])
  return state
}

export function OrcaPitDevnxProjectSection({
  repo,
  updateRepo,
  forceVisible
}: {
  repo: Repo
  updateRepo: (
    id: string,
    updates: { devnxControlProject: DevnxControlProjectReference | null }
  ) => unknown
  forceVisible?: boolean
}): React.JSX.Element | null {
  const connection = useOrcaPitDevnxConnection()
  const projects = useControlProjects(repo.id, connection.connected)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!connection.connected) {
    return null
  }
  const value = repo.devnxControlProject ?? null
  const list = projects.status === 'ready' ? projects.list : null
  const suggested = list?.projects.find((project) => project.id === list.suggestedProjectId) ?? null
  const apply = async (project: DevnxControlProjectReference | null): Promise<void> => {
    setOpen(false)
    setSaving(true)
    setError(null)
    try {
      const result = await updateRepo(repo.id, { devnxControlProject: project })
      const echoed = useAppStore
        .getState()
        .repos.find(
          (entry) =>
            entry.id === repo.id && getRepoExecutionHostId(entry) === getRepoExecutionHostId(repo)
        )?.devnxControlProject
      if (result === false || (echoed?.id ?? null) !== (project?.id ?? null)) {
        throw new Error(
          translate('devnx.projectLink.saveFailed', 'Could not save the DevNX Control project.')
        )
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setSaving(false)
    }
  }
  const label = translate('devnx.projectLink.title', 'DevNX Control project')
  const noneLabel = translate('devnx.projectLink.none', 'Not linked')
  const suggestionLabel =
    list?.suggestionReason === 'remote'
      ? translate('devnx.projectLink.suggestedRemote', 'Suggested: same git repository')
      : translate('devnx.projectLink.suggestedName', 'Suggested: similar name')
  return (
    <SearchableSetting
      title={label}
      description={translate(
        'devnx.projectLink.description',
        'Tasks of this Control project appear under Tasks, and workspaces created from them are linked to the task.'
      )}
      keywords={['devnx', 'control', 'project', 'task', repo.displayName]}
      forceVisible={forceVisible}
      className="space-y-2"
    >
      <p className="text-sm font-semibold">{label}</p>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-label={label}
            aria-expanded={open}
            disabled={projects.status === 'loading' || saving}
            className="w-full justify-between"
          >
            <span className="truncate">{value ? value.name : noneLabel}</span>
            <ChevronsUpDown className="size-4 shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start">
          <Command>
            <CommandInput
              placeholder={translate('devnx.projectLink.search', 'Search Control projects')}
            />
            <CommandList>
              <CommandEmpty>
                {translate('devnx.projectLink.empty', 'No projects found.')}
              </CommandEmpty>
              <CommandItem value={noneLabel} onSelect={() => void apply(null)}>
                <span className="flex-1">{noneLabel}</span>
                {!value ? <Check className="size-4" /> : null}
              </CommandItem>
              {(list?.projects ?? []).map((project) => (
                <CommandItem
                  key={project.id}
                  value={`${project.name} ${project.client ?? ''} ${project.tenant?.name ?? ''} ${project.id}`}
                  onSelect={() => void apply({ id: project.id, name: project.name })}
                  data-devnx-suggested={project.id === suggested?.id ? '' : undefined}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 truncate">
                      {project.name}
                      {project.id === suggested?.id ? (
                        <Sparkles className="size-3.5 shrink-0 text-amber-500" aria-hidden />
                      ) : null}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {project.id === suggested?.id
                        ? suggestionLabel
                        : [project.client, project.tenant?.name].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  {value?.id === project.id ? <Check className="size-4" /> : null}
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {suggested && value?.id !== suggested.id ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Sparkles className="size-3.5 text-amber-500" aria-hidden />
          <span>
            {suggestionLabel} ·{' '}
            <span className="font-medium text-foreground">{suggested.name}</span>
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={saving}
            onClick={() => void apply({ id: suggested.id, name: suggested.name })}
          >
            {translate('devnx.projectLink.useSuggestion', 'Use suggestion')}
          </Button>
        </div>
      ) : null}
      {error || projects.status === 'error' ? (
        <p role="alert" className="text-xs text-destructive">
          {error ?? (projects.status === 'error' ? projects.error : null)}
        </p>
      ) : null}
    </SearchableSetting>
  )
}
