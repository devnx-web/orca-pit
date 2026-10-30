// Orca-Pit: the "Agents" view organized by project. One header per project even when it lives
// on several machines (same DevNX Control project, same Orca project, same git remote or same
// name), the projects with agents on top by their newest agent, and the ones with none folded
// at the end under "No agent right now", closed until opened.
import type { GroupHeaderRow, Row } from '../../../../../../shared/sidebar-list/row-types'
import type { Repo } from '../../../../../../shared/repo-types'
import { folderWorkspaceKey } from '../../../../../../shared/workspace-scope'
import {
  IDLE_PROJECTS_OPEN_KEY,
  IDLE_PROJECTS_SECTION_KEY,
  isProjectActivitySectionKey
} from '../../../../../../shared/sidebar-list/orca-pit-activity-sections'

/** Workspace id (or `folder:<id>` key) → when its newest agent last changed. */
export type AgentRecency = ReadonlyMap<string, number>

type Sub = { header: GroupHeaderRow; rows: Row[] }
type Block = {
  header: GroupHeaderRow
  tokens: string[]
  loose: Row[]
  subs: Sub[]
  createRepos: Repo[]
}

// Why pending creations count as newest: the workspace being created is what the user just did.
const PENDING_RECENCY = Number.MAX_SAFE_INTEGER

function rowRecency(row: Row, recency: AgentRecency): number | null {
  switch (row.type) {
    case 'item':
      return recency.get(row.worktree.id) ?? 0
    case 'folder-workspace':
      return recency.get(folderWorkspaceKey(row.folderWorkspace.id)) ?? 0
    case 'pending-creation':
      return PENDING_RECENCY
    default:
      return null
  }
}

function newest(rows: readonly Row[], recency: AgentRecency): number | null {
  let best: number | null = null
  for (const row of rows) {
    const at = rowRecency(row, recency)
    if (at !== null && (best === null || at > best)) {
      best = at
    }
  }
  return best
}

function byNewest(rows: readonly Row[], recency: AgentRecency): Row[] {
  return [...rows].sort((a, b) => (rowRecency(b, recency) ?? 0) - (rowRecency(a, recency) ?? 0))
}

export function normalizeProjectName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase()
}

/** What makes two headers one project; headers sharing any token merge. */
export function projectIdentityTokens(header: GroupHeaderRow): string[] {
  const repo = header.repo ?? header.orcaPitCreateRepo
  const tokens = [`name:${normalizeProjectName(header.label ?? header.key)}`]
  const control = repo?.devnxControlProject?.id
  if (control) {
    tokens.push(`control:${control}`)
  }
  const project = /^project:([^:]+)/.exec(header.key)?.[1]
  if (project) {
    tokens.push(`project:${project}`)
  }
  const remote = header.repo?.gitRemoteIdentity?.canonicalKey
  if (remote) {
    tokens.push(`git:${remote}`)
  }
  return tokens
}

function addRepo(list: Repo[], repo: Repo | undefined): void {
  if (repo && !list.some((entry) => entry.id === repo.id)) {
    list.push(repo)
  }
}

/** Splits buildRows' output into one block per top-level header, nested projects as subs. */
function readBlocks(rows: readonly Row[]): { lead: Row[]; blocks: Block[] } {
  const lead: Row[] = []
  const blocks: Block[] = []
  let block: Block | null = null
  let sub: Sub | null = null
  for (const row of rows) {
    if (row.type === 'header' && isProjectActivitySectionKey(row.key)) {
      continue
    }
    if (row.type === 'header' && (row.projectGroupDepth ?? 0) === 0) {
      block = {
        header: row,
        tokens: projectIdentityTokens(row),
        loose: [],
        subs: [],
        createRepos: []
      }
      addRepo(block.createRepos, row.repo ?? row.orcaPitCreateRepo)
      blocks.push(block)
      sub = null
      continue
    }
    if (row.type === 'header') {
      // A nested group only folds its rows into the project; a nested project may keep a header.
      sub = row.repo && block ? { header: row, rows: [] } : null
      if (block && sub) {
        block.subs.push(sub)
        if (!block.header.repo && block.createRepos.length === 0) {
          addRepo(block.createRepos, row.repo)
        }
      }
      continue
    }
    if (sub) {
      sub.rows.push(row)
    } else if (block) {
      block.loose.push(row)
    } else {
      lead.push(row)
    }
  }
  return { lead, blocks }
}

/** Union of blocks sharing an identity token, in first-seen order. */
function mergeBlocks(blocks: readonly Block[]): Block[] {
  const merged: Block[] = []
  const byToken = new Map<string, Block>()
  for (const block of blocks) {
    const target = block.tokens.map((token) => byToken.get(token)).find(Boolean)
    if (!target) {
      const copy: Block = { ...block, loose: [...block.loose], subs: [...block.subs] }
      copy.createRepos = [...block.createRepos]
      merged.push(copy)
      block.tokens.forEach((token) => byToken.set(token, copy))
      continue
    }
    target.loose.push(...block.loose)
    for (const sub of block.subs) {
      const name = normalizeProjectName(sub.header.label ?? sub.header.key)
      const same = target.subs.find(
        (entry) => normalizeProjectName(entry.header.label ?? entry.header.key) === name
      )
      if (same) {
        same.rows.push(...sub.rows)
      } else {
        target.subs.push({ header: sub.header, rows: [...sub.rows] })
      }
    }
    block.createRepos.forEach((repo) => addRepo(target.createRepos, repo))
    block.tokens.forEach((token) => byToken.set(token, target))
  }
  return merged
}

function blockRows(block: Block, recency: AgentRecency): { rows: Row[]; at: number | null } {
  const subsWithRows = block.subs.filter((sub) => newest(sub.rows, recency) !== null)
  const all = [...block.loose, ...block.subs.flatMap((sub) => sub.rows)]
  const at = newest(all, recency)
  const [first] = block.createRepos
  const header: GroupHeaderRow = {
    ...block.header,
    count: all.filter((row) => rowRecency(row, recency) !== null).length,
    ...(block.header.repo ? {} : { orcaPitCreateRepo: first }),
    ...(block.createRepos.length > 1 ? { orcaPitCreateRepos: block.createRepos } : {})
  }
  if (subsWithRows.length < 2) {
    return { rows: [header, ...byNewest(all, recency)], at }
  }
  // A group with agents in several of its projects shows each of them under the group.
  const subs = [...subsWithRows].sort(
    (a, b) => (newest(b.rows, recency) ?? 0) - (newest(a.rows, recency) ?? 0)
  )
  return {
    rows: [
      header,
      ...byNewest(block.loose, recency),
      ...subs.flatMap((sub) => [
        { ...sub.header, count: sub.rows.length },
        ...byNewest(sub.rows, recency)
      ])
    ],
    at
  }
}

/** The organized rows with nothing collapsed; `rows` come from buildRows with nothing collapsed. */
export function organizeAgentsViewRows(rows: readonly Row[], recency: AgentRecency): Row[] {
  const { lead, blocks } = readBlocks(rows)
  const active: { rows: Row[]; at: number }[] = []
  const idle: Row[] = []
  for (const block of mergeBlocks(blocks)) {
    const built = blockRows(block, recency)
    if (built.at !== null) {
      active.push({ rows: built.rows, at: built.at })
    } else if (block.createRepos.length > 0) {
      // A group with no project in it at all has nothing to offer, so it leaves the list.
      idle.push(...built.rows)
    }
  }
  active.sort((a, b) => b.at - a.at)
  const result = [...lead, ...active.flatMap((entry) => entry.rows)]
  if (idle.length === 0) {
    return result
  }
  if (active.length === 0) {
    // Nothing running anywhere: a lone closed fold would hide every project.
    return [...result, ...idle]
  }
  const fold: GroupHeaderRow = {
    type: 'header',
    key: IDLE_PROJECTS_SECTION_KEY,
    collapseKey: IDLE_PROJECTS_OPEN_KEY,
    orcaPitOpenWhenSet: true,
    count: idle.filter((row) => row.type === 'header').length,
    icon: { kind: 'orca-pit-idle' }
  }
  return [...result, fold, ...idle]
}

/** Applies collapse to organized rows: a project hides its rows, the closed fold its projects. */
export function collapseAgentsViewRows(
  rows: readonly Row[],
  collapsedGroups: ReadonlySet<string>
): Row[] {
  const result: Row[] = []
  let inClosedFold = false
  let skipProject = false
  let skipSub = false
  for (const row of rows) {
    if (row.type === 'header' && row.key === IDLE_PROJECTS_SECTION_KEY) {
      result.push(row)
      inClosedFold = !collapsedGroups.has(IDLE_PROJECTS_OPEN_KEY)
      continue
    }
    if (inClosedFold) {
      continue
    }
    if (row.type === 'header') {
      const collapsed = collapsedGroups.has(row.collapseKey ?? row.key)
      if ((row.projectGroupDepth ?? 0) === 0) {
        skipProject = collapsed
        skipSub = false
        result.push(row)
      } else if (!skipProject) {
        skipSub = collapsed
        result.push(row)
      }
      continue
    }
    if (!skipProject && !skipSub) {
      result.push(row)
    }
  }
  return result
}
