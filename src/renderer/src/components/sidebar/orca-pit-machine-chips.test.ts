import { describe, expect, it } from 'vitest'
import type { GroupHeaderRow, Row, WorktreeRow } from '../../../../shared/sidebar-list/row-types'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import { ACTIVE_PROJECTS_SECTION_KEY } from '../../../../shared/sidebar-list/orca-pit-activity-sections'
import {
  orcaPitHash,
  orcaPitMachineTone,
  orcaPitPersonTone,
  orcaPitToneIndex
} from './orca-pit-colors'
import { planOrcaPitMachineChips, resolveOrcaPitMachineLabel } from './orca-pit-machine-chips'
import { repo, worktree } from './worktree-list-groups-test-fixtures'

const NITRO: ExecutionHostId = 'runtime:nitro5'

function header(key: string): GroupHeaderRow {
  return { type: 'header', key, count: 1, icon: { kind: 'project' } }
}

function item(id: string, hostId?: ExecutionHostId): WorktreeRow {
  return {
    type: 'item',
    rowKey: id,
    sectionKey: 'section',
    worktree: { ...worktree, id, ...(hostId ? { hostId } : {}) },
    repo,
    depth: 0,
    groupDepth: 0,
    isLastLineageChild: false,
    lineageChildCount: 0
  }
}

describe('Orca-Pit machine chip placement', () => {
  it('names nothing while every agent runs on one machine', () => {
    const plan = planOrcaPitMachineChips(
      [header('a'), item('w1'), item('w2'), header('b'), item('w3')],
      'local'
    )
    expect(plan.hostByWorkspaceId.size).toBe(0)
  })

  it('names other machines on their rows, and every row of a project on several', () => {
    const rows: Row[] = [
      header('central-only'),
      item('w1'),
      header('nitro-only'),
      item('w3', NITRO),
      header('mixed'),
      item('w4'),
      { ...header('nested'), projectGroupDepth: 1 },
      item('w5', NITRO)
    ]
    expect([...planOrcaPitMachineChips(rows, 'local').hostByWorkspaceId]).toEqual([
      ['w3', NITRO],
      ['w4', 'local'],
      ['w5', NITRO]
    ])
  })

  it('reads a section header as no project and uses the focused host for unstamped rows', () => {
    const plan = planOrcaPitMachineChips(
      [header(ACTIVE_PROJECTS_SECTION_KEY), item('w1'), item('w2', 'local')],
      NITRO
    )
    expect([...plan.hostByWorkspaceId]).toEqual([
      ['w1', NITRO],
      ['w2', 'local']
    ])
  })
})

describe('Orca-Pit machine names', () => {
  it('names the central by what it reports, never "Local"', () => {
    expect(
      resolveOrcaPitMachineLabel({
        hostId: 'local',
        machineName: 'central-devnx',
        localFallback: 'Local Linux'
      })
    ).toBe('central-devnx')
    expect(resolveOrcaPitMachineLabel({ hostId: 'local', localFallback: 'Local Linux' })).toBe(
      'Local Linux'
    )
  })

  it('prefers an override, then a paired server name unless it is the unnamed default', () => {
    const base = { hostId: NITRO, machineName: 'nitro5-fabio', localFallback: 'x' }
    expect(resolveOrcaPitMachineLabel({ ...base, override: 'GPU' })).toBe('GPU')
    expect(resolveOrcaPitMachineLabel({ ...base, environmentName: 'Nitro5' })).toBe('Nitro5')
    expect(resolveOrcaPitMachineLabel({ ...base, environmentName: 'Orca Server' })).toBe(
      'nitro5-fabio'
    )
    expect(resolveOrcaPitMachineLabel({ hostId: NITRO, localFallback: 'x' })).toBe('nitro5')
  })
})

describe('Orca-Pit colors', () => {
  it('gives the same machine and person the same color on every run', () => {
    expect(orcaPitHash('central-devnx')).toBe(orcaPitHash('central-devnx'))
    expect(orcaPitMachineTone('Nitro5')).toBe(orcaPitMachineTone(' nitro5 '))
    expect(orcaPitPersonTone('u:7')).toBe(orcaPitPersonTone('u:7'))
    // FNV-1a of "a": pinned so a refactor cannot silently repaint every machine.
    expect(orcaPitHash('a')).toBe(0xe40c292c)
  })

  it('spreads names over the palette', () => {
    const indexes = new Set(
      ['central', 'nitro5', 'gpu-vm', 'notebook', 'servidor', 'mac-mini'].map((name) =>
        orcaPitToneIndex(name, 8)
      )
    )
    expect(indexes.size).toBeGreaterThan(2)
  })
})
