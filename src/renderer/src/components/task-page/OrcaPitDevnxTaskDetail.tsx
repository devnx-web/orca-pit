// Orca-Pit: a DevNX Control task on its own page — read-only in v1, with the workspace action
// and a link to the task in the Control front, where the card is moved.
import { useEffect, useState } from 'react'
import { ArrowLeft, ExternalLink, LoaderCircle, Play, SquareArrowOutUpRight } from 'lucide-react'
import type { Repo } from '../../../../shared/repo-types'
import type { DevnxControlTaskDetail } from '../../../../shared/orca-pit-devnx-tasks'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { useAllWorktrees } from '@/store/selectors'
import { orcaPitDevnxApi } from '@/lib/orca-pit-devnx-status'
import {
  findDevnxTaskWorkspace,
  openDevnxTaskInControl,
  openDevnxTaskWorkspace,
  startWorkspaceFromDevnxTask
} from '@/lib/orca-pit-devnx-task-actions'
import {
  devnxTaskDueDateLabel,
  devnxTaskPriorityLabel,
  devnxTaskStatusLabel,
  devnxTaskStatusTone
} from '@/lib/orca-pit-devnx-task-labels'
import { cn } from '@/lib/utils'

function useDevnxTask(taskId: number) {
  const [task, setTask] = useState<DevnxControlTaskDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const api = orcaPitDevnxApi()
    if (!api) {
      return
    }
    let cancelled = false
    setTask(null)
    setError(null)
    void api.getTask(taskId).then(
      (result) => {
        if (!cancelled) {
          setTask(result.ok ? result.value : null)
          setError(result.ok ? null : result.error)
        }
      },
      (caught: unknown) => {
        if (!cancelled) {
          setError(String(caught))
        }
      }
    )
    return () => {
      cancelled = true
    }
  }, [taskId])
  return { task, error }
}

function Fact({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm">{value}</dd>
    </div>
  )
}

export function OrcaPitDevnxTaskDetail({
  taskId,
  repo,
  onBack
}: {
  taskId: number
  repo: Repo | null
  onBack: () => void
}): React.JSX.Element {
  const { task, error } = useDevnxTask(taskId)
  const workspaces = useAllWorktrees()
  const existing = findDevnxTaskWorkspace(taskId, workspaces)
  return (
    <div className="mt-3 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto rounded-md border border-border/50 bg-muted/30 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4" />
          {translate('devnx.tasks.back', 'DevNX Control tasks')}
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!task?.url}
            onClick={() => openDevnxTaskInControl(task?.url ?? null)}
          >
            <ExternalLink className="size-4" />
            {translate('devnx.tasks.openInControl', 'Open in DevNX Control')}
          </Button>
          {existing ? (
            <Button type="button" size="sm" onClick={() => openDevnxTaskWorkspace(existing)}>
              <SquareArrowOutUpRight className="size-4" />
              {translate('devnx.tasks.openWorkspace', 'Open workspace')}
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              disabled={!task}
              onClick={() => task && startWorkspaceFromDevnxTask(task, repo)}
            >
              <Play className="size-4" />
              {translate('devnx.tasks.startWorkspace', 'Start workspace')}
            </Button>
          )}
        </div>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : !task ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" />
          {translate('devnx.tasks.loadingTask', 'Loading task…')}
        </div>
      ) : (
        <>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">#{task.id}</p>
            <h2 className="text-lg font-semibold">{task.title}</h2>
          </div>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">
                {translate('devnx.tasks.column.status', 'Status')}
              </dt>
              <dd>
                <span
                  className={cn(
                    'inline-flex rounded-full border px-2 py-0.5 text-xs',
                    devnxTaskStatusTone(task.status)
                  )}
                >
                  {devnxTaskStatusLabel(task.status)}
                </span>
              </dd>
            </div>
            <Fact
              label={translate('devnx.tasks.column.priority', 'Priority')}
              value={devnxTaskPriorityLabel(task.priority)}
            />
            <Fact
              label={translate('devnx.tasks.column.assignee', 'Assignee')}
              value={
                task.assignees.map((user) => user.name).join(', ') ||
                translate('devnx.tasks.unassigned', 'Unassigned')
              }
            />
            <Fact
              label={translate('devnx.tasks.column.dueDate', 'Due')}
              value={devnxTaskDueDateLabel(task.dueDate)}
            />
          </dl>
          <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
            {task.description ??
              translate('devnx.tasks.noDescription', 'This task has no description.')}
          </div>
        </>
      )}
    </div>
  )
}
