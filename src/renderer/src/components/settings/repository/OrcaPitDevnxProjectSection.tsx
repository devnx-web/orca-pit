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
import { devnxFailureText, useOrcaPitDevnxConnection } from '@/lib/orca-pit-devnx-status'
import {
  devnxTargetForRepo,
  devnxTargetKey,
  devnxTargetOfKey,
  listDevnxProjects
} from '@/runtime/orca-pit-devnx-client'
import { Button } from '../../ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/popover'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '../../ui/command'
import { SearchableSetting } from '../SearchableSetting'
import { getRepositoryDevnxProjectSectionId } from './repository-settings-targets'
import { translate } from '@/i18n/i18n'

type ProjectsState =
  | { status: 'loading' }
  | { status: 'ready'; list: DevnxControlProjectList }
  | { status: 'error'; error: string }

function useControlProjects(targetKey: string | null, repoId: string, enabled: boolean) {
  const [state, setState] = useState<ProjectsState>({ status: 'loading' })
  useEffect(() => {
    if (!enabled || !targetKey) {
      return
    }
    let cancelled = false
    setState({ status: 'loading' })
    void listDevnxProjects(devnxTargetOfKey(targetKey), { repoId }).then((result) => {
      if (!cancelled) {
        setState(
          result.ok
            ? { status: 'ready', list: result.value }
            : { status: 'error', error: devnxFailureText(result) }
        )
      }
    })
    return () => {
      cancelled = true
    }
  }, [enabled, repoId, targetKey])
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
  // The host that owns the project answers, with the person's own Control login.
  const target = devnxTargetForRepo(repo)
  const connection = useOrcaPitDevnxConnection(target)
  const projects = useControlProjects(
    target ? devnxTargetKey(target) : null,
    repo.id,
    connection.connected && connection.canLink
  )
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
  const description = translate(
    'devnx.projectLink.description',
    'Tasks of this Control project appear under Tasks, and workspaces created from them are linked to the task.'
  )
  const keywords = ['devnx', 'control', 'project', 'task', repo.displayName]
  const sectionId = getRepositoryDevnxProjectSectionId(repo.id)
  if (!connection.canLink) {
    // A member sees the link; the Control's admins decide where the team's work is counted.
    return (
      <SearchableSetting
        title={label}
        description={description}
        keywords={keywords}
        forceVisible={forceVisible}
        className="space-y-2"
        id={sectionId}
      >
        <p className="text-sm font-semibold">{label}</p>
        <p className="text-sm">{value ? value.name : noneLabel}</p>
        <p className="text-xs text-muted-foreground">
          {translate(
            'devnx.projectLink.adminOnly',
            'Only an administrator of the company in DevNX Control can change this link.'
          )}
        </p>
      </SearchableSetting>
    )
  }
  const suggestionLabel =
    list?.suggestionReason === 'remote'
      ? translate('devnx.projectLink.suggestedRemote', 'Suggested: same git repository')
      : translate('devnx.projectLink.suggestedName', 'Suggested: similar name')
  return (
    <SearchableSetting
      title={label}
      description={description}
      keywords={keywords}
      forceVisible={forceVisible}
      className="space-y-2"
      id={sectionId}
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
