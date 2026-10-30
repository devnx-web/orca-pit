// Orca-Pit: F2 renames an agent from its sidebar row — with the pointer over the row, or with the
// row focused. The name lands where the tab bar's rename puts it (`setTabCustomTitle`): on the
// host that owns the tab, so everyone who sees that agent reads the same name. Empty goes back
// to the automatic name.
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { isImeOwnedKeyboardEvent } from '@/lib/ime-composition-keyboard-event'

export function isRenameKey(
  event: Pick<KeyboardEvent, 'key' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>
): boolean {
  return event.key === 'F2' && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey
}

export function renameAgentTab(tabId: string, value: string): void {
  const trimmed = value.trim()
  useAppStore.getState().setTabCustomTitle(tabId, trimmed.length > 0 ? trimmed : null)
}

export function useOrcaPitAgentRowRename(tabId: string, currentName: string) {
  const [editing, setEditing] = useState(false)
  const [hovered, setHovered] = useState(false)
  const start = useCallback(() => setEditing(true), [])
  // Why a window listener while hovered: after a click the terminal holds the focus, and
  // "point at it and press F2" is the gesture people expect from a list.
  useEffect(() => {
    if (!hovered || editing) {
      return
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isRenameKey(event)) {
        event.preventDefault()
        event.stopPropagation()
        start()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [hovered, editing, start])
  const rowProps = {
    onMouseEnter: () => setHovered(true),
    onMouseLeave: () => setHovered(false),
    onKeyDown: (event: React.KeyboardEvent) => {
      if (!editing && isRenameKey(event.nativeEvent)) {
        event.preventDefault()
        event.stopPropagation()
        start()
      }
    }
  }
  const editor = editing ? (
    <OrcaPitAgentRenameInput
      initial={currentName}
      onDone={(value) => {
        setEditing(false)
        if (value !== null && value.trim() !== currentName.trim()) {
          renameAgentTab(tabId, value)
        }
      }}
    />
  ) : null
  return { editing, rowProps, editor }
}

function OrcaPitAgentRenameInput({
  initial,
  onDone
}: {
  initial: string
  /** The typed name, or null when cancelled. */
  onDone: (value: string | null) => void
}): React.JSX.Element {
  const [value, setValue] = useState(initial)
  const doneRef = useRef(false)
  const finish = (next: string | null): void => {
    if (!doneRef.current) {
      doneRef.current = true
      onDone(next)
    }
  }
  return (
    <input
      // oxlint-disable-next-line jsx-a11y/no-autofocus -- the input only exists because F2 asked for it
      autoFocus
      value={value}
      aria-label={translate('devnx.agentRename.label', 'Agent name')}
      placeholder={translate('devnx.agentRename.placeholder', 'Empty = automatic name')}
      className="h-5 min-w-0 flex-1 rounded-sm border border-border bg-background px-1 text-[11px] text-foreground outline-none focus:ring-1 focus:ring-ring"
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setValue(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (isImeOwnedKeyboardEvent(event)) {
          return
        }
        if (event.key === 'Enter') {
          event.preventDefault()
          finish(value)
        } else if (event.key === 'Escape') {
          event.preventDefault()
          finish(null)
        }
      }}
      onBlur={() => finish(value)}
    />
  )
}
