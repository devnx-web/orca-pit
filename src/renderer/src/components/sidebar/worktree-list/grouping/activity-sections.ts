// Orca-Pit: splits the repo-grouped sidebar into "Active" and "Inactive" sections. The unit
// is what the user reads as a project — a top-level Project Group with everything under it,
// or an ungrouped repo — so a group never shows up half in each section.
import { Moon, Zap } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import type { ProjectGroup } from '../../../../../../shared/project-group-types'
import type { ProjectOrderBy } from '../../../../../../shared/ui-chrome-types'
import type { ProjectActivity } from '../../orca-pit-project-activity'
import type { RenderableFolderWorkspace } from './folder-workspace-lanes'
import { appendOrderedGroups } from './group-sections'
import type { SectionAppendContext } from './group-sections'
import { appendProjectGroupSections } from './project-group-sections'
import type { OrderedGroupEntry } from './project-grouping'
import { withRepoSectionDisplayLabels } from './section-order'

export const ACTIVE_PROJECTS_SECTION_KEY = 'orca-pit-activity:active'
export const INACTIVE_PROJECTS_SECTION_KEY = 'orca-pit-activity:inactive'

export function isProjectActivitySectionKey(key: string): boolean {
  return key === ACTIVE_PROJECTS_SECTION_KEY || key === INACTIVE_PROJECTS_SECTION_KEY
}

type ActivitySectionArgs = {
  orderedGroups: OrderedGroupEntry[]
  projectGroups: readonly ProjectGroup[]
  folderWorkspaces: readonly RenderableFolderWorkspace[]
  projectOrderBy: ProjectOrderBy
  repoOrder: Map<string, number> | undefined
}

function createRootGroupLookup(projectGroups: readonly ProjectGroup[]): (id: string) => string {
  const byId = new Map(projectGroups.map((group) => [group.id, group]))
  return (id) => {
    let current = id
    const seen = new Set<string>()
    for (;;) {
      const parentId = byId.get(current)?.parentGroupId
      // Why the seen set: a corrupt parent chain must not hang the sidebar.
      if (!parentId || !byId.has(parentId) || seen.has(parentId)) {
        return current
      }
      seen.add(current)
      current = parentId
    }
  }
}

/** Returns false, appending nothing, when every project falls on the same side: one lone
 *  header over the whole list would only push the projects down. */
export function appendProjectActivitySections(
  ctx: SectionAppendContext,
  args: ActivitySectionArgs,
  activity: ProjectActivity
): boolean {
  const groupIds = new Set(args.projectGroups.map((group) => group.id))
  const rootOf = createRootGroupLookup(args.projectGroups)
  // Why the unit falls back to the repo: a repo whose group metadata has not loaded yet is
  // rendered at the top level by appendProjectGroupSections, so it is its own project here.
  const repoUnit = (entry: OrderedGroupEntry): string => {
    const repo = entry[1].repo
    if (repo?.projectGroupId && groupIds.has(repo.projectGroupId)) {
      return `group:${rootOf(repo.projectGroupId)}`
    }
    return `repo:${repo?.id ?? entry[0]}`
  }
  const folderUnit = (pair: RenderableFolderWorkspace): string =>
    `group:${rootOf(pair.folderWorkspace.projectGroupId)}`

  const activeUnits = new Set<string>()
  for (const entry of args.orderedGroups) {
    if (entry[1].repo && activity.activeRepoIds.has(entry[1].repo.id)) {
      activeUnits.add(repoUnit(entry))
    }
  }
  for (const pair of args.folderWorkspaces) {
    if (activity.activeFolderWorkspaceIds.has(pair.folderWorkspace.id)) {
      activeUnits.add(folderUnit(pair))
    }
  }

  const allUnits = new Set([
    ...args.orderedGroups.map(repoUnit),
    ...args.folderWorkspaces.map(folderUnit),
    ...args.projectGroups.map((group) => `group:${rootOf(group.id)}`)
  ])
  const activeCount = [...allUnits].filter((unit) => activeUnits.has(unit)).length
  if (activeCount === 0 || activeCount === allUnits.size) {
    return false
  }

  const appendSection = (active: boolean): void => {
    const keep = (unit: string): boolean => activeUnits.has(unit) === active
    const orderedGroups = args.orderedGroups.filter((entry) => keep(repoUnit(entry)))
    const projectGroups = args.projectGroups.filter((group) => keep(`group:${rootOf(group.id)}`))
    const folderWorkspaces = args.folderWorkspaces.filter((pair) => keep(folderUnit(pair)))
    const key = active ? ACTIVE_PROJECTS_SECTION_KEY : INACTIVE_PROJECTS_SECTION_KEY
    ctx.result.push({
      type: 'header',
      key,
      label: active
        ? translate('devnx.activity.active', 'Active')
        : translate('devnx.activity.inactive', 'Inactive'),
      count: active ? activeCount : allUnits.size - activeCount,
      tone: active ? 'text-foreground' : 'text-muted-foreground',
      icon: active ? Zap : Moon
    })
    if (ctx.collapsedGroups.has(key)) {
      return
    }
    if (args.projectGroups.length === 0) {
      appendOrderedGroups(ctx, withRepoSectionDisplayLabels(orderedGroups))
      return
    }
    appendProjectGroupSections(ctx, { ...args, orderedGroups, projectGroups, folderWorkspaces })
  }

  appendSection(true)
  appendSection(false)
  return true
}
