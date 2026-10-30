import { describe, expect, it } from 'vitest'
import type {
  GroupHeaderRow,
  Row,
  WorktreeRow
} from '../../../../../../shared/sidebar-list/row-types'
import type { Repo } from '../../../../../../shared/repo-types'
import {
  IDLE_PROJECTS_OPEN_KEY,
  IDLE_PROJECTS_SECTION_KEY
} from '../../../../../../shared/sidebar-list/orca-pit-activity-sections'
import { repo as baseRepo, worktree } from '../../worktree-list-groups-test-fixtures'
import {
  collapseAgentsViewRows,
  normalizeProjectName,
  organizeAgentsViewRows
} from './orca-pit-project-rows'

function repo(id: string, extra: Partial<Repo> = {}): Repo {
  return { ...baseRepo, id, displayName: id, ...extra }
}

function header(key: string, label: string, owner?: Repo, depth = 0): GroupHeaderRow {
  return {
    type: 'header',
    key,
    label,
    count: 0,
    icon: { kind: 'project' },
    ...(owner ? { repo: owner } : {}),
    ...(depth ? { projectGroupDepth: depth } : {})
  }
}

function item(id: string, owner: Repo): WorktreeRow {
  return {
    type: 'item',
    rowKey: id,
    sectionKey: 'section',
    worktree: { ...worktree, id, repoId: owner.id },
    repo: owner,
    depth: 0,
    groupDepth: 0,
    isLastLineageChild: false,
    lineageChildCount: 0
  }
}

function shape(rows: readonly Row[]): string[] {
  return rows.map((row) =>
    row.type === 'header'
      ? row.key === IDLE_PROJECTS_SECTION_KEY
        ? `fold(${row.count})`
        : `# ${row.label}`
      : row.type === 'item'
        ? row.worktree.id
        : row.type
  )
}

const momentoCentral = repo('momento-central', { executionHostId: 'local' })
const momentoNitro = repo('momento-nitro', { executionHostId: 'runtime:nitro5' })
const jacarei = repo('jacarei', { devnxControlProject: { id: 7, name: 'Site Jacarei' } })
const portal = repo('portal', { devnxControlProject: { id: 7, name: 'Site Jacarei' } })
const idleRepo = repo('griffinlog')

describe('Orca-Pit: Agents view by project', () => {
  it('merges one project spread over machines into one header with both "+" targets', () => {
    const rows = organizeAgentsViewRows(
      [
        header('repo:momento-central', 'Momento', momentoCentral),
        item('w-central', momentoCentral),
        header('repo:momento-nitro', 'momento', momentoNitro),
        item('w-nitro', momentoNitro)
      ],
      new Map([
        ['w-central', 100],
        ['w-nitro', 200]
      ])
    )
    expect(shape(rows)).toEqual(['# Momento', 'w-nitro', 'w-central'])
    const merged = rows[0] as GroupHeaderRow
    expect(merged.count).toBe(2)
    expect(merged.orcaPitCreateRepos?.map((entry) => entry.id)).toEqual([
      'momento-central',
      'momento-nitro'
    ])
  })

  it('merges projects linked to the same DevNX Control project even under other names', () => {
    const rows = organizeAgentsViewRows(
      [
        header('repo:jacarei', 'jacarei', jacarei),
        item('w1', jacarei),
        header('repo:portal', 'portal-jacarei', portal),
        item('w2', portal)
      ],
      new Map([
        ['w1', 1],
        ['w2', 2]
      ])
    )
    expect(shape(rows)).toEqual(['# jacarei', 'w2', 'w1'])
  })

  it('orders projects by their newest agent and folds the ones with none', () => {
    const rows = organizeAgentsViewRows(
      [
        header('repo:jacarei', 'jacarei', jacarei),
        item('old', jacarei),
        header('repo:griffinlog', 'griffinlog', idleRepo),
        header('repo:momento-nitro', 'Momento', momentoNitro),
        item('new', momentoNitro)
      ],
      new Map([
        ['old', 10],
        ['new', 20]
      ])
    )
    expect(shape(rows)).toEqual(['# Momento', 'new', '# jacarei', 'old', 'fold(1)', '# griffinlog'])
    expect(shape(collapseAgentsViewRows(rows, new Set()))).toEqual([
      '# Momento',
      'new',
      '# jacarei',
      'old',
      'fold(1)'
    ])
    expect(shape(collapseAgentsViewRows(rows, new Set([IDLE_PROJECTS_OPEN_KEY])))).toContain(
      '# griffinlog'
    )
    expect(shape(collapseAgentsViewRows(rows, new Set(['repo:jacarei'])))).toEqual([
      '# Momento',
      'new',
      '# jacarei',
      'fold(1)'
    ])
  })

  it('drops a project group with no project in it', () => {
    const rows = organizeAgentsViewRows(
      [
        header('project-group:vazio', 'Ailiv Soluções'),
        header('repo:jacarei', 'jacarei', jacarei),
        item('w1', jacarei),
        header('repo:griffinlog', 'griffinlog', idleRepo)
      ],
      new Map([['w1', 1]])
    )
    expect(shape(rows)).toEqual(['# jacarei', 'w1', 'fold(1)', '# griffinlog'])
  })

  it('names projects alike regardless of case and accents', () => {
    expect(normalizeProjectName(' Educação ')).toBe(normalizeProjectName('educacao'))
  })
})
