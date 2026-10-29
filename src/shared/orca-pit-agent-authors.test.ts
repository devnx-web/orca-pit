import { describe, expect, it } from 'vitest'
import { orcaPitAgentAuthorLabel, parseOrcaPitAgentAuthors } from './orca-pit-agent-authors'

describe('Orca-Pit agent author label', () => {
  const authors = parseOrcaPitAgentAuthors({
    authors: {
      'tab-1:pane': { name: 'Fulano', at: 1 },
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
})
