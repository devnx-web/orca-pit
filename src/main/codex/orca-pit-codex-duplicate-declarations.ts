// Orca-Pit: drop from the mirrored config.toml what Codex already loads from elsewhere in the same
// home. Installers like get-shit-done write each agent role twice (an `[agents.<name>]` table here
// and `agents/<name>.toml`) and a hook twice (`[[hooks.<Event>]]` here and `hooks.json`); a recent
// Codex then opens every chat with one "duplicate agent role" warning per agent and "loading hooks
// from both", and the twice-declared hook runs twice. The copy in agents/ and hooks.json stays;
// only the config.toml twin is left out, and only when its twin really exists.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'

const HEADER = /^\s*\[/
const AGENT_TABLE = /^\[agents\.(?:"([^"]+)"|([\w-]+))\]\s*(?:#.*)?$/
const HOOK_GROUP = /^\[\[hooks\.([\w-]+)\]\]\s*(?:#.*)?$/
const COMMAND_LINE = /^\s*command\s*=\s*(.+?)\s*$/

/** Agent role names declared by `agents/*.toml` (its `name`, else the file name). */
export function agentRoleNamesInDirectory(agentsDir: string): Set<string> {
  const names = new Set<string>()
  if (!existsSync(agentsDir)) {
    return names
  }
  for (const file of readdirSync(agentsDir)) {
    if (!file.endsWith('.toml')) {
      continue
    }
    let declared: string | null = null
    try {
      const text = readFileSync(join(agentsDir, file), 'utf8')
      declared = /^\s*name\s*=\s*["']([^"']+)["']/m.exec(text)?.[1] ?? null
    } catch {
      // An unreadable file declares nothing we can match.
    }
    names.add(declared ?? basename(file, '.toml'))
  }
  return names
}

/** Quotes and spacing differ between TOML and JSON spellings of the same command. */
export function normalizeHookCommand(command: string): string {
  return command.replace(/\\"/g, '"').replace(/["']/g, '').replace(/\s+/g, ' ').trim()
}

/** Every command `hooks.json` declares, normalized. */
export function hookCommandsInJson(hooksJsonPath: string): Set<string> {
  const commands = new Set<string>()
  if (!existsSync(hooksJsonPath)) {
    return commands
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(hooksJsonPath, 'utf8'))
    const visit = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(visit)
      } else if (value && typeof value === 'object') {
        for (const [key, inner] of Object.entries(value)) {
          if (key === 'command' && typeof inner === 'string') {
            commands.add(normalizeHookCommand(inner))
          } else {
            visit(inner)
          }
        }
      }
    }
    visit(parsed)
  } catch {
    // Unparsable hooks.json: keep config.toml's hooks untouched.
  }
  return commands
}

function tomlStringValue(raw: string): string {
  const literal = /^'(.*)'$/.exec(raw)
  if (literal) {
    return literal[1]
  }
  const basic = /^"(.*)"$/.exec(raw)
  return basic ? basic[1] : raw
}

/** The end (exclusive) of the table starting at `start`: the next header line. */
function tableEnd(lines: readonly string[], start: number): number {
  let end = start + 1
  while (end < lines.length && !HEADER.test(lines[end])) {
    end += 1
  }
  return end
}

export function dropDuplicatedCodexDeclarations(
  config: string,
  twins: { agentNames: ReadonlySet<string>; hookCommands: ReadonlySet<string> }
): string {
  const lines = config.split('\n')
  const out: string[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index]
    const agent = AGENT_TABLE.exec(line)
    if (agent && twins.agentNames.has(agent[1] ?? agent[2])) {
      index = tableEnd(lines, index)
      continue
    }
    const group = HOOK_GROUP.exec(line)
    if (group && twins.hookCommands.size > 0) {
      // The group and its `[[hooks.<Event>.hooks]]` / `[hooks.<Event>...]` children.
      const childPrefix = `[[hooks.${group[1]}.`
      const childTablePrefix = `[hooks.${group[1]}.`
      let end = tableEnd(lines, index)
      while (
        end < lines.length &&
        (lines[end].trim().startsWith(childPrefix) || lines[end].trim().startsWith(childTablePrefix))
      ) {
        end = tableEnd(lines, end)
      }
      const commands = lines
        .slice(index, end)
        .map((candidate) => COMMAND_LINE.exec(candidate)?.[1])
        .filter((raw): raw is string => raw !== undefined)
        .map((raw) => normalizeHookCommand(tomlStringValue(raw)))
      if (commands.length > 0 && commands.every((command) => twins.hookCommands.has(command))) {
        index = end
        continue
      }
    }
    out.push(line)
    index += 1
  }
  return out.join('\n')
}

/** The mirror's step: twins looked up in the source home the config came from. */
export function dropDuplicatedCodexDeclarationsFromHome(
  config: string,
  systemConfigDir: string
): string {
  return dropDuplicatedCodexDeclarations(config, {
    agentNames: agentRoleNamesInDirectory(join(systemConfigDir, 'agents')),
    hookCommands: hookCommandsInJson(join(systemConfigDir, 'hooks.json'))
  })
}
