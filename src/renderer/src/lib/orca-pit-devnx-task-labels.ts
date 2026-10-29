// Orca-Pit: how DevNX Control task statuses and priorities read in Orca.
import { translate } from '@/i18n/i18n'

export function devnxTaskStatusLabel(status: string): string {
  switch (status) {
    case 'pending':
      return translate('devnx.tasks.status.pending', 'Pending')
    case 'in_progress':
      return translate('devnx.tasks.status.inProgress', 'In progress')
    case 'review':
      return translate('devnx.tasks.status.review', 'In review')
    case 'blocked':
      return translate('devnx.tasks.status.blocked', 'Blocked')
    case 'completed':
      return translate('devnx.tasks.status.completed', 'Completed')
    case 'cancelled':
      return translate('devnx.tasks.status.cancelled', 'Cancelled')
    default:
      return status
  }
}

/** Tailwind classes for the status pill; unknown statuses stay neutral. */
export function devnxTaskStatusTone(status: string): string {
  switch (status) {
    case 'in_progress':
      return 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300'
    case 'review':
      return 'border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-300'
    case 'blocked':
      return 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300'
    case 'completed':
      return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
    case 'cancelled':
      return 'border-border bg-muted/40 text-muted-foreground line-through'
    default:
      return 'border-border bg-muted/40 text-muted-foreground'
  }
}

export function devnxTaskPriorityLabel(priority: string | null): string {
  switch (priority) {
    case 'low':
      return translate('devnx.tasks.priority.low', 'Low')
    case 'medium':
      return translate('devnx.tasks.priority.medium', 'Medium')
    case 'high':
      return translate('devnx.tasks.priority.high', 'High')
    case 'urgent':
      return translate('devnx.tasks.priority.urgent', 'Urgent')
    default:
      return priority ?? '—'
  }
}

/** `2026-10-31` as the user's short local date, without a timezone shift. */
export function devnxTaskDueDateLabel(dueDate: string | null): string {
  if (!dueDate) {
    return '—'
  }
  const [year, month, day] = dueDate.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return Number.isNaN(date.getTime()) ? dueDate : date.toLocaleDateString()
}
