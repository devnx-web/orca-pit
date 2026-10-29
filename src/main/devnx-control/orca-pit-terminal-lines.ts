// Orca-Pit: turns what a person types into the lines they submit. Keystrokes stay in memory
// only until Enter; the diary sees the finished line, never the keys (decision of 29/10/2026).

const MAX_LINE_CHARS = 2000
const MAX_LINES_PER_CHUNK = 20
const MAX_TRACKED_TERMINALS = 512
// Why: a huge paste is a document, not a command; only its tail can become the next line.
const MAX_CHUNK_CHARS = 16_384

type LineState = {
  text: string
  /** History recall or tab completion changed the line where we cannot see it. */
  recalled: boolean
}

const NO_LINES: readonly string[] = []

function isPlainChar(code: number): boolean {
  return code >= 0x20 && code !== 0x7f
}

/** Length of the escape sequence at `index` (ESC already seen), or the rest of the chunk. */
function escapeLength(data: string, index: number): number {
  const next = data[index + 1]
  if (next === '[') {
    let end = index + 2
    while (end < data.length) {
      const code = data.charCodeAt(end)
      if (code >= 0x40 && code <= 0x7e) {
        return end - index + 1
      }
      end += 1
    }
    return data.length - index
  }
  if (next === 'O') {
    return Math.min(3, data.length - index)
  }
  return next === undefined ? 1 : 2
}

const HISTORY_KEYS = new Set(['\u001b[A', '\u001b[B', '\u001bOA', '\u001bOB'])

function isHistoryKey(sequence: string): boolean {
  return HISTORY_KEYS.has(sequence)
}

function dropLastWord(text: string): string {
  return text.replace(/\S+\s*$/, '')
}

export class OrcaPitLineBuffer {
  private readonly states = new Map<string, LineState>()

  /** Completed lines in this chunk, trimmed; empty ones dropped. */
  feed(key: string, raw: string): readonly string[] {
    if (!raw) {
      return NO_LINES
    }
    let state = this.states.get(key)
    // Fast path for the common case: one printable key.
    if (raw.length === 1 && isPlainChar(raw.charCodeAt(0))) {
      if (!state) {
        state = this.track(key)
      }
      if (state.text.length < MAX_LINE_CHARS) {
        state.text += raw
      }
      return NO_LINES
    }
    state ??= this.track(key)
    const data = raw.length > MAX_CHUNK_CHARS ? raw.slice(-MAX_CHUNK_CHARS) : raw
    const lines: string[] = []
    let index = 0
    while (index < data.length) {
      const char = data[index]
      const code = data.charCodeAt(index)
      if (char === '\u001b') {
        const length = escapeLength(data, index)
        const sequence = data.slice(index, index + length)
        if (isHistoryKey(sequence)) {
          state.recalled = true
        }
        // Bracketed-paste markers wrap text that is part of the line.
        index += length
        continue
      }
      if (char === '\r' || char === '\n') {
        const line = state.text.trim()
        if (line && lines.length < MAX_LINES_PER_CHUNK) {
          // The ellipsis says the start came from history or completion we did not see.
          lines.push(state.recalled ? `… ${line}` : line)
        }
        state.text = ''
        state.recalled = false
        index += char === '\r' && data[index + 1] === '\n' ? 2 : 1
        continue
      }
      if (code === 0x7f || code === 0x08) {
        state.text = Array.from(state.text).slice(0, -1).join('')
      } else if (code === 0x15 || code === 0x03) {
        state.text = ''
        state.recalled = false
      } else if (code === 0x17) {
        state.text = dropLastWord(state.text)
      } else if (code === 0x09) {
        state.recalled = true
      } else if (isPlainChar(code) && state.text.length < MAX_LINE_CHARS) {
        state.text += char
      }
      index += 1
    }
    return lines
  }

  forget(key: string): void {
    this.states.delete(key)
  }

  private track(key: string): LineState {
    if (this.states.size >= MAX_TRACKED_TERMINALS) {
      const oldest = this.states.keys().next().value
      if (oldest !== undefined) {
        this.states.delete(oldest)
      }
    }
    const state: LineState = { text: '', recalled: false }
    this.states.set(key, state)
    return state
  }
}
