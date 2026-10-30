// @vitest-environment happy-dom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isRenameKey, useOrcaPitAgentRowRename } from './orca-pit-agent-row-rename'

const store = vi.hoisted(() => ({ setTabCustomTitle: vi.fn() }))
vi.mock('@/store', () => ({ useAppStore: { getState: () => store } }))

function Row({ name }: { name: string }) {
  const rename = useOrcaPitAgentRowRename('tab-1', name)
  return (
    <div data-testid="row" {...rename.rowProps}>
      {rename.editor ?? <span>{name}</span>}
    </div>
  )
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('Orca-Pit: F2 renames an agent row', () => {
  it('only takes a plain F2', () => {
    const base = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false }
    expect(isRenameKey({ ...base, key: 'F2' })).toBe(true)
    expect(isRenameKey({ ...base, key: 'F2', ctrlKey: true })).toBe(false)
    expect(isRenameKey({ ...base, key: 'Enter' })).toBe(false)
  })

  it('opens on F2 while the pointer is over the row and saves on Enter', () => {
    render(<Row name="Claude Chat" />)
    fireEvent.mouseEnter(screen.getByTestId('row'))
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2' }))
    })
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '  Migração Jacarei  ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(store.setTabCustomTitle).toHaveBeenCalledWith('tab-1', 'Migração Jacarei')
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('cancels on Escape and goes back to the automatic name when emptied', () => {
    render(<Row name="Claude Chat" />)
    fireEvent.keyDown(screen.getByTestId('row'), { key: 'F2' })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
    expect(store.setTabCustomTitle).not.toHaveBeenCalled()
    fireEvent.keyDown(screen.getByTestId('row'), { key: 'F2' })
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(store.setTabCustomTitle).toHaveBeenCalledWith('tab-1', null)
  })

  it('ignores F2 when the pointer is elsewhere', () => {
    render(<Row name="Claude Chat" />)
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2' }))
    })
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})
