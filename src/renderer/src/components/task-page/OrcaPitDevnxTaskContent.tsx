// Orca-Pit: the DevNX Control source in Tasks — the cards of the Control project linked to the
// selected Orca projects. Rows open the task's page; v1 never moves a card.
import { useState } from 'react'
import { LoaderCircle, RefreshCw, Search, UserRound } from 'lucide-react'
import type { TaskPageComposerActionsModel } from './use-task-page-composer-actions'
import { DEVNX_TASK_STATUSES } from '../../../../shared/orca-pit-devnx-tasks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'
import {
  devnxFailureText,
  hasLocalDevnxControlBridge,
  useOrcaPitDevnxConnection
} from '@/lib/orca-pit-devnx-status'
import {
  devnxDefaultTarget,
  devnxTargetForRepo,
  devnxTargetKey
} from '@/runtime/orca-pit-devnx-client'
import {
  devnxTaskDueDateLabel,
  devnxTaskPriorityLabel,
  devnxTaskStatusLabel,
  devnxTaskStatusTone
} from '@/lib/orca-pit-devnx-task-labels'
import {
  getDevnxLinkedProjects,
  useOrcaPitDevnxTasks,
  type DevnxStatusFilter
} from './use-orca-pit-devnx-tasks'
import { OrcaPitDevnxTaskDetail } from './OrcaPitDevnxTaskDetail'

function Notice({
  text,
  action
}: {
  text: string
  action?: { label: string; onClick: () => void }
}): React.JSX.Element {
  return (
    <div className="mt-3 flex flex-col items-start gap-3 rounded-md border border-border/50 bg-muted/30 p-6 text-sm text-muted-foreground">
      <p>{text}</p>
      {action ? (
        <Button type="button" size="sm" variant="outline" onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
    </div>
  )
}

export function OrcaPitDevnxTaskContent({
  model
}: {
  model: TaskPageComposerActionsModel
}): React.JSX.Element {
  const openSettingsPage = useAppStore((s) => s.openSettingsPage)
  const openSettingsTarget = useAppStore((s) => s.openSettingsTarget)
  // Each Cmd+J open is a new taskPageData, so going back dismisses only that one request.
  const pageData = useAppStore((s) => s.taskPageData)
  const projects = getDevnxLinkedProjects(model.selectedRepos, model.repos)
  const [chosenProjectId, setChosenProjectId] = useState<number | null>(null)
  const project = projects.find((entry) => entry.id === chosenProjectId) ?? projects[0] ?? null
  const repo = project?.repos[0] ?? model.selectedRepos[0] ?? null
  // The host that owns the Orca project reads the Control, with this person's own login.
  const target = repo ? devnxTargetForRepo(repo) : devnxDefaultTarget()
  const targetKey = target ? devnxTargetKey(target) : null
  const connection = useOrcaPitDevnxConnection(target)
  const list = useOrcaPitDevnxTasks(connection.connected ? (project?.id ?? null) : null, targetKey)
  const [openedTaskId, setOpenedTaskId] = useState<number | null>(null)
  const [dismissedPage, setDismissedPage] = useState<object | null>(null)
  const detailTaskId =
    openedTaskId ?? (pageData !== dismissedPage ? (pageData.openDevnxTaskId ?? null) : null)

  if (connection.checking) {
    return <Notice text={translate('devnx.tasks.checking', 'Checking DevNX Control…')} />
  }
  if (connection.needsLogin) {
    return <Notice text={devnxFailureText({ code: 'relogin', error: '' })} />
  }
  if (!connection.connected) {
    // Only this app's own window signs the machine in; elsewhere the central's admin does.
    const local = target?.kind === 'local' && hasLocalDevnxControlBridge()
    return (
      <Notice
        text={
          local
            ? translate(
                'devnx.tasks.signIn',
                'Sign in to DevNX Control under Settings → Accounts to see its tasks here.'
              )
            : translate(
                'devnx.tasks.hostNotConnected',
                'The Orca that holds this project is not connected to DevNX Control.'
              )
        }
        action={
          local
            ? {
                label: translate('devnx.tasks.openAccounts', 'Open Accounts'),
                onClick: () => {
                  openSettingsPage()
                  openSettingsTarget({
                    pane: 'accounts',
                    repoId: null,
                    sectionId: 'accounts-devnx-control'
                  })
                }
              }
            : undefined
        }
      />
    )
  }
  if (detailTaskId !== null) {
    return (
      <OrcaPitDevnxTaskDetail
        taskId={detailTaskId}
        repo={repo}
        targetKey={targetKey}
        onBack={() => {
          setOpenedTaskId(null)
          setDismissedPage(pageData)
        }}
      />
    )
  }
  if (!project) {
    const target = model.selectedRepos[0] ?? model.repos[0] ?? null
    return (
      <Notice
        text={translate(
          'devnx.tasks.noLink',
          'No Orca project is linked to a DevNX Control project yet. Choose it in the project settings, under “DevNX Control project”.'
        )}
        action={
          target
            ? {
                label: translate('devnx.tasks.openProjectSettings', 'Open project settings'),
                onClick: () => {
                  openSettingsPage()
                  openSettingsTarget({ pane: 'repo', repoId: target.id })
                }
              }
            : undefined
        }
      />
    )
  }
  const statusOptions: { value: DevnxStatusFilter; label: string }[] = [
    { value: 'open', label: translate('devnx.tasks.filter.open', 'Open') },
    ...DEVNX_TASK_STATUSES.map((status) => ({
      value: status,
      label: devnxTaskStatusLabel(status)
    })),
    { value: 'all', label: translate('devnx.tasks.filter.all', 'All') }
  ]
  return (
    <div className="mt-3 flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {projects.length > 1 ? (
          <Select
            value={String(project.id)}
            onValueChange={(value) => setChosenProjectId(Number(value))}
          >
            <SelectTrigger className="h-8 w-[220px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {projects.map((entry) => (
                <SelectItem key={entry.id} value={String(entry.id)}>
                  {entry.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <span className="text-sm font-medium">{project.name}</span>
        )}
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={list.search}
            onChange={(event) => list.setSearch(event.target.value)}
            placeholder={translate('devnx.tasks.search', 'Search tasks')}
            aria-label={translate('devnx.tasks.search', 'Search tasks')}
            className="h-8 pl-7 text-xs"
          />
        </div>
        <Select
          value={list.statusFilter}
          onValueChange={(value) => list.setStatusFilter(value as DevnxStatusFilter)}
        >
          <SelectTrigger
            className="h-8 w-[150px] text-xs"
            aria-label={translate('devnx.tasks.column.status', 'Status')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {statusOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          size="sm"
          variant={list.mine ? 'default' : 'outline'}
          aria-pressed={list.mine}
          onClick={() => list.setMine(!list.mine)}
        >
          <UserRound className="size-3.5" />
          {translate('devnx.tasks.mine', 'Mine')}
        </Button>
        <Button
          type="button"
          size="icon-sm"
          variant="outline"
          onClick={list.refresh}
          aria-label={translate('devnx.tasks.refresh', 'Refresh')}
        >
          {list.loading ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : (
            <RefreshCw className="size-3.5" />
          )}
        </Button>
      </div>
      {list.error ? (
        <p role="alert" className="text-xs text-destructive">
          {list.error}
        </p>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto scrollbar-sleek rounded-md border border-border/50">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-muted/80 text-xs text-muted-foreground backdrop-blur">
            <tr>
              <th className="px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">
                {translate('devnx.tasks.column.title', 'Task')}
              </th>
              <th className="px-3 py-2 font-medium">
                {translate('devnx.tasks.column.status', 'Status')}
              </th>
              <th className="px-3 py-2 font-medium">
                {translate('devnx.tasks.column.priority', 'Priority')}
              </th>
              <th className="px-3 py-2 font-medium">
                {translate('devnx.tasks.column.assignee', 'Assignee')}
              </th>
              <th className="px-3 py-2 font-medium">
                {translate('devnx.tasks.column.dueDate', 'Due')}
              </th>
            </tr>
          </thead>
          <tbody>
            {list.tasks.map((task) => (
              <tr
                key={task.id}
                tabIndex={0}
                onClick={() => setOpenedTaskId(task.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    setOpenedTaskId(task.id)
                  }
                }}
                className="cursor-pointer border-t border-border/40 hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
              >
                <td className="px-3 py-2 text-xs text-muted-foreground">{task.id}</td>
                <td className="max-w-[420px] truncate px-3 py-2">{task.title}</td>
                <td className="px-3 py-2">
                  <span
                    className={cn(
                      'inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-xs',
                      devnxTaskStatusTone(task.status)
                    )}
                  >
                    {devnxTaskStatusLabel(task.status)}
                  </span>
                </td>
                <td className="px-3 py-2 text-xs">{devnxTaskPriorityLabel(task.priority)}</td>
                <td className="truncate px-3 py-2 text-xs">
                  {task.assignee?.name ?? translate('devnx.tasks.unassigned', 'Unassigned')}
                </td>
                <td className="px-3 py-2 text-xs">{devnxTaskDueDateLabel(task.dueDate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!list.loading && list.tasks.length === 0 && !list.error ? (
          <p className="p-6 text-center text-sm text-muted-foreground">
            {translate('devnx.tasks.empty', 'No tasks match these filters.')}
          </p>
        ) : null}
      </div>
    </div>
  )
}
