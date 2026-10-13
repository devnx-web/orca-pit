// Isolated CLI homes for brokered sessions. Personal logins in ~/.claude,
// ~/.codex and ~/.gemini are only read for preferences, never for auth.
import {
  accessSync,
  chmodSync,
  constants,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync
} from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join, relative, resolve, isAbsolute } from 'node:path'
import { writeSecureFile, writeSecureJsonFile } from '../../shared/secure-file'
import { DevnxControlError, isRecord } from './devnx-control-http'
import {
  GEMINI_TOKEN_RELATIVE_PATH,
  type GeminiClient,
  type OpenAiClient
} from './devnx-control-payloads'
import type { DevnxControlPaths } from './devnx-control-paths'

const CODEX_STATIC_DIRS = ['skills', 'rules', 'plugins', 'packages', 'agents', 'themes']
const GEMINI_STATIC_DIRS = ['extensions', 'commands']
const GEMINI_SNAPSHOT_FILES = ['settings.json', 'GEMINI.md']
const GEMINI_SHIM_NAME = 'agy'
// Why a dead address: with the Secret Service reachable `agy` reads the keyring
// session and ignores the file, silently signing the pane into the personal account.
const GEMINI_BLOCKED_BUS = 'unix:path=/nonexistent/orca-pit-sem-keyring'

function ensurePrivateDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
}

function readJsonObject(file: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function assertInside(root: string, target: string): void {
  const rel = relative(resolve(root), resolve(target))
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new DevnxControlError('Sessão brokerada fora do diretório do DevNX Control.', {
      code: 'UNSAFE_SESSION_PATH'
    })
  }
}

function linkStaticDirs(sourceRoot: string, targetRoot: string, names: string[]): void {
  for (const name of names) {
    const source = join(sourceRoot, name)
    const target = join(targetRoot, name)
    try {
      if (statSync(source).isDirectory() && !existsSync(target)) {
        symlinkSync(source, target, 'dir')
      }
    } catch {
      // Why: a missing static dir is normal; never copy a tree that may hold credentials.
    }
  }
}

export function prepareCodexHome(codexHome: string): void {
  ensurePrivateDir(codexHome)
  const sourceHome = join(homedir(), '.codex')
  // Why a snapshot: a global config edit must not change a terminal already running.
  try {
    writeSecureFile(
      join(codexHome, 'config.toml'),
      readFileSync(join(sourceHome, 'config.toml'), 'utf8')
    )
  } catch {
    // No personal config is a valid starting point.
  }
  linkStaticDirs(sourceHome, codexHome, CODEX_STATIC_DIRS)
}

export function writeCodexAuth(
  codexRoot: string,
  codexHome: string,
  client: OpenAiClient,
  capability: string
): void {
  const authPath = join(codexHome, 'auth.json')
  assertInside(codexRoot, authPath)
  writeSecureJsonFile(authPath, {
    auth_mode: client.authMode,
    last_refresh: client.lastRefresh,
    tokens: {
      access_token: client.accessToken,
      id_token: client.idToken,
      account_id: client.accountId,
      // Why: Codex sends this back to our loopback endpoint, which asks the panel to refresh.
      refresh_token: capability
    }
  })
}

export function removeCodexAuth(codexHome: string): void {
  rmSync(join(codexHome, 'auth.json'), { force: true })
}

/** On logout: drop every brokered session file, keeping each account's history and settings. */
export function removeBrokeredSessions(paths: DevnxControlPaths): void {
  const accountDirs = (root: string): string[] => {
    try {
      return readdirSync(join(root, 'accounts'), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(root, 'accounts', entry.name))
    } catch {
      return []
    }
  }
  for (const home of accountDirs(paths.codexRoot)) {
    removeCodexAuth(home)
  }
  for (const home of accountDirs(paths.geminiRoot)) {
    rmSync(join(home, GEMINI_TOKEN_RELATIVE_PATH), { force: true })
  }
  // Why: without a connection `agy` must resolve to the user's own CLI again.
  rmSync(paths.geminiBinRoot, { recursive: true, force: true })
}

/** The OAuth token reaches Claude through the proxy, so this home only carries preferences. */
export function prepareClaudeHome(claudeHome: string): void {
  ensurePrivateDir(claudeHome)
  rmSync(join(claudeHome, '.credentials.json'), { force: true })
  const settingsPath = join(claudeHome, 'settings.json')
  const settings = readJsonObject(settingsPath)
  if (settings.skipDangerousModePermissionPrompt !== true || !settings.theme) {
    writeSecureJsonFile(settingsPath, {
      ...settings,
      skipDangerousModePermissionPrompt: true,
      theme: typeof settings.theme === 'string' ? settings.theme : 'dark'
    })
  }
  // Why: CLAUDE_CODE_OAUTH_TOKEN authenticates the process, but a fresh config dir still opens
  // the login wizard until onboarding is marked done. The marker holds no account data.
  const configPath = join(claudeHome, '.claude.json')
  const config = readJsonObject(configPath)
  if (config.hasCompletedOnboarding !== true) {
    writeSecureJsonFile(configPath, {
      ...config,
      hasCompletedOnboarding: true
    })
  }
}

function prepareGeminiHome(home: string): void {
  const destination = join(home, '.gemini')
  ensurePrivateDir(destination)
  const sourceHome = join(homedir(), '.gemini')
  for (const name of GEMINI_SNAPSHOT_FILES) {
    try {
      writeSecureFile(join(destination, name), readFileSync(join(sourceHome, name), 'utf8'))
    } catch {
      // Optional preference file.
    }
  }
  // Why not antigravity-cli/: that is where the session lives; a link would mix pool and personal login.
  linkStaticDirs(sourceHome, destination, GEMINI_STATIC_DIRS)
}

export function writeGeminiSession(geminiRoot: string, home: string, client: GeminiClient): void {
  prepareGeminiHome(home)
  const tokenPath = join(home, client.relativePath)
  assertInside(geminiRoot, tokenPath)
  ensurePrivateDir(dirname(tokenPath))
  writeSecureFile(tokenPath, client.payload)
}

function isInside(root: string, entry: string): boolean {
  const rel = relative(resolve(root), resolve(entry))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** Finds the real `agy` on PATH, skipping our own shims. */
function resolveGeminiCli(pathValue: string, binRoot: string): string | null {
  for (const entry of pathValue.split(delimiter)) {
    if (!entry || isInside(binRoot, entry)) {
      continue
    }
    const candidate = join(resolve(entry), GEMINI_SHIM_NAME)
    try {
      if (statSync(candidate).isFile()) {
        accessSync(candidate, constants.X_OK)
        return candidate
      }
    } catch {
      // Not on this PATH entry.
    }
  }
  return null
}

/**
 * Puts an `agy` shim first on PATH that swaps HOME for the CLI process only. Without a
 * selection the shim points at an empty home, so `agy` asks for login instead of falling
 * back to the personal account. Returns the PATH unchanged when `agy` is not installed.
 */
export function applyGeminiShim(
  pathValue: string,
  binRoot: string,
  shimDir: string,
  home: string
): string {
  const inherited = pathValue.split(delimiter).filter((entry) => entry && !isInside(binRoot, entry))
  const cli = resolveGeminiCli(inherited.join(delimiter), binRoot)
  if (!cli) {
    return inherited.join(delimiter)
  }
  prepareGeminiHome(home)
  ensurePrivateDir(shimDir)
  const quote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`
  const shim =
    '#!/bin/sh\n' +
    '# Gerado pelo Orca-Pit: roda o Antigravity CLI na conta do DevNX Control\n' +
    '# sem tocar no login pessoal em ~/.gemini nem no keyring.\n' +
    `exec env HOME=${quote(home)} DBUS_SESSION_BUS_ADDRESS=${quote(GEMINI_BLOCKED_BUS)} ${quote(cli)} "$@"\n`
  const shimPath = join(shimDir, GEMINI_SHIM_NAME)
  writeSecureFile(shimPath, shim)
  // Why chmod after the write: writeSecureFile publishes 0600, which the shell cannot execute.
  chmodSync(shimPath, 0o700)
  return [shimDir, ...inherited].join(delimiter)
}
