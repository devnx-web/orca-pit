import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  dropDuplicatedCodexDeclarationsFromHome,
  normalizeHookCommand
} from './orca-pit-codex-duplicate-declarations'

const CONFIG = `model = "gpt-5"

# GSD Agent Configuration — managed by get-shit-done installer

[agents.gsd-verifier]
description = "Verifies."
config_file = '/home/u/.codex/agents/gsd-verifier.toml'

[agents.only-here]
description = "Has no agents/ twin."

# GSD Hooks

[[hooks.SessionStart]]

[[hooks.SessionStart.hooks]]
type = "command"
command = "\\"/usr/bin/node\\" \\"/home/u/.codex/hooks/gsd-check-update.js\\""

[[hooks.Stop]]

[[hooks.Stop.hooks]]
type = "command"
command = "bash /home/u/only-in-toml.sh"

[hooks.state."/home/u/.codex/config.toml:session_start:0:0"]
trusted_hash = "abc"

[mcp_servers.docs]
url = "https://example.com"
`

let home: string | null = null

function makeHome(withHooksJson = true): string {
  home = mkdtempSync(join(tmpdir(), 'orca-pit-codex-dup-'))
  mkdirSync(join(home, 'agents'))
  writeFileSync(join(home, 'agents', 'gsd-verifier.toml'), 'name = "gsd-verifier"\n')
  if (withHooksJson) {
    writeFileSync(
      join(home, 'hooks.json'),
      JSON.stringify({
        hooks: {
          SessionStart: [
            {
              hooks: [
                {
                  type: 'command',
                  command: `"/usr/bin/node" '/home/u/.codex/hooks/gsd-check-update.js'`
                }
              ]
            }
          ]
        }
      })
    )
  }
  return home
}

afterEach(() => {
  if (home) {
    rmSync(home, { recursive: true, force: true })
    home = null
  }
})

describe('dropDuplicatedCodexDeclarationsFromHome', () => {
  it('drops the agent table whose role agents/ already declares, keeps the others', () => {
    const out = dropDuplicatedCodexDeclarationsFromHome(CONFIG, makeHome())
    expect(out).not.toContain('[agents.gsd-verifier]')
    expect(out).not.toContain("config_file = '/home/u/.codex/agents/gsd-verifier.toml'")
    expect(out).toContain('[agents.only-here]')
  })

  it('drops a hook group hooks.json declares too, despite different quoting', () => {
    const out = dropDuplicatedCodexDeclarationsFromHome(CONFIG, makeHome())
    expect(out).not.toContain('[[hooks.SessionStart]]')
    expect(out).not.toContain('gsd-check-update')
  })

  it('keeps hooks only config.toml declares, hook trust state and other tables', () => {
    const out = dropDuplicatedCodexDeclarationsFromHome(CONFIG, makeHome())
    expect(out).toContain('[[hooks.Stop]]')
    expect(out).toContain('bash /home/u/only-in-toml.sh')
    expect(out).toContain('[hooks.state."/home/u/.codex/config.toml:session_start:0:0"]')
    expect(out).toContain('[mcp_servers.docs]')
    expect(out).toContain('model = "gpt-5"')
  })

  it('keeps every hook when there is no hooks.json', () => {
    const out = dropDuplicatedCodexDeclarationsFromHome(CONFIG, makeHome(false))
    expect(out).toContain('[[hooks.SessionStart]]')
    expect(out).toContain('gsd-check-update')
  })

  it('changes nothing in a config without twins', () => {
    const plain = 'model = "gpt-5"\n\n[mcp_servers.docs]\nurl = "x"\n'
    expect(dropDuplicatedCodexDeclarationsFromHome(plain, makeHome())).toBe(plain)
  })
})

describe('normalizeHookCommand', () => {
  it('treats TOML-escaped and JSON-quoted spellings as the same command', () => {
    expect(normalizeHookCommand('\\"/usr/bin/node\\" \\"/a/b.js\\"')).toBe(
      normalizeHookCommand(`"/usr/bin/node" '/a/b.js'`)
    )
  })
})
