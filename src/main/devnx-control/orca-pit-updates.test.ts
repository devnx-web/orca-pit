import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false, getVersion: () => '1.4.214' } }))

import { compareReleaseVersions, parseReleasesManifest, summarizeUpdate } from './orca-pit-updates'
import { buildManifest } from '../../../config/scripts/orca-pit-releases-manifest.mjs'

const release = (version: string, active = true) => ({ version, date: '', notes: [], active })

describe('Orca-Pit updater', () => {
  it('orders by Orca version first and the fork build second', () => {
    expect(compareReleaseVersions('1.4.214-pit10', '1.4.214-pit9')).toBeGreaterThan(0)
    expect(compareReleaseVersions('1.4.215-pit1', '1.4.214-pit9')).toBeGreaterThan(0)
    expect(compareReleaseVersions('1.4.214-pit2', '1.4.214-pit2')).toBe(0)
    // A run outside the .deb only knows Orca's version, so every release is newer.
    expect(compareReleaseVersions('1.4.214-pit1', '1.4.214')).toBeGreaterThan(0)
  })

  it('offers only active releases newer than the installed one, newest first', () => {
    const check = summarizeUpdate('1.4.214-pit2', [
      release('1.4.214-pit3'),
      release('1.4.214-pit5', false),
      release('1.4.214-pit4'),
      release('1.4.214-pit1')
    ])
    expect(check.latest).toBe('1.4.214-pit4')
    expect(check.newer.map((entry) => entry.version)).toEqual(['1.4.214-pit4', '1.4.214-pit3'])
  })

  it('drops manifest entries whose version could not be used in the install URL', () => {
    const releases = parseReleasesManifest({
      releases: [{ version: '1.4.214-pit3; rm -rf /' }, { version: '1.4.214-pit3', notes: ['ok'] }]
    })
    expect(releases).toEqual([{ version: '1.4.214-pit3', date: '', notes: ['ok'], active: true }])
  })

  it('builds the manifest from the changelog, joining wrapped bullets and skipping withdrawn', () => {
    const manifest = buildManifest(
      [
        '# Orca-Pit — mudanças',
        '',
        '## 1.4.214-pit3 — 15/10/2026 (retirada)',
        '',
        '- Quebrou o terminal.',
        '',
        '## 1.4.214-pit2 — 14/10/2026',
        '',
        '- Projetos se dividem em **Ativos** e',
        '  **Inativos**.',
        '- Outra coisa.'
      ].join('\n')
    )
    expect(manifest.latest).toBe('1.4.214-pit2')
    expect(manifest.releases).toEqual([
      {
        version: '1.4.214-pit3',
        date: '15/10/2026',
        notes: ['Quebrou o terminal.'],
        active: false
      },
      {
        version: '1.4.214-pit2',
        date: '14/10/2026',
        notes: ['Projetos se dividem em **Ativos** e **Inativos**.', 'Outra coisa.'],
        active: true
      }
    ])
  })
})
