import { describe, expect, it } from 'vitest'
import {
  orcaPitAge,
  orcaPitAgentAuthorLabel,
  orcaPitAuthorKey,
  orcaPitAuthorLine,
  orcaPitInitials,
  parseOrcaPitAgentAuthors
} from './orca-pit-agent-authors'

describe('Orca-Pit agent author label', () => {
  const authors = parseOrcaPitAgentAuthors({
    authors: {
      'tab-1:pane': { name: 'Fulano', at: 1, userId: 7 },
      'tab-2:pane': { name: '  Maria Clara ', at: 2 },
      'tab-3:pane': { name: 'Bartholomeuzinhooo', at: 3 },
      'tab-4:pane': { name: 7, at: 4 }
    }
  })

  it('shows the first name of whoever sent the last command', () => {
    expect(orcaPitAgentAuthorLabel(authors, 'tab-1:pane')).toBe('Fulano')
    expect(orcaPitAgentAuthorLabel(authors, 'tab-2:pane')).toBe('Maria')
  })

  it('cuts a very long name', () => {
    expect(orcaPitAgentAuthorLabel(authors, 'tab-3:pane')).toBe('Bartholomeuzinh…')
  })

  it('shows nothing for unknown panes, malformed entries or no data', () => {
    expect(orcaPitAgentAuthorLabel(authors, 'tab-4:pane')).toBeNull()
    expect(orcaPitAgentAuthorLabel(authors, 'missing')).toBeNull()
    expect(orcaPitAgentAuthorLabel(authors, 'constructor')).toBeNull()
    expect(orcaPitAgentAuthorLabel(null, 'tab-1:pane')).toBeNull()
    expect(parseOrcaPitAgentAuthors('nope')).toEqual({})
  })

  it('keys a person by Control user, falling back to the name for older centrals', () => {
    expect(orcaPitAuthorKey(authors['tab-1:pane']!)).toBe('u:7')
    expect(orcaPitAuthorKey(authors['tab-2:pane']!)).toBe('n:Maria Clara')
  })
})

describe('Orca-Pit author line', () => {
  const MIN = 60_000

  it('reads "Fabio · 3m" with the age of the last command', () => {
    const now = 10_000 * MIN
    expect(orcaPitAuthorLine({ name: 'Fabio Gomes', at: now - 3 * MIN }, now, 'agora')).toBe(
      'Fabio · 3m'
    )
    expect(orcaPitAuthorLine({ name: 'Fabio', at: now - 20_000 }, now, 'agora')).toBe(
      'Fabio · agora'
    )
    expect(orcaPitAuthorLine({ name: '   ', at: now }, now, 'agora')).toBeNull()
  })

  it('rolls minutes into hours and days, and treats a skewed future stamp as now', () => {
    const now = 100_000 * MIN
    expect(orcaPitAge(now - 59 * MIN, now, 'now')).toBe('59m')
    expect(orcaPitAge(now - 125 * MIN, now, 'now')).toBe('2h')
    expect(orcaPitAge(now - 3 * 24 * 60 * MIN, now, 'now')).toBe('3d')
    expect(orcaPitAge(now + 5 * MIN, now, 'now')).toBe('now')
  })

  it('draws initials from the first and last name', () => {
    expect(orcaPitInitials('Fabio Gomes da Silva')).toBe('FS')
    expect(orcaPitInitials('ana')).toBe('A')
    expect(orcaPitInitials('  ')).toBe('?')
    expect(orcaPitInitials('Élio Ñunes')).toBe('ÉÑ')
  })
})
