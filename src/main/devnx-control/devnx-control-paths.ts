import { createHash } from 'node:crypto'
import { join } from 'node:path'

/** Every file DevNX Control owns lives under `<userData>/devnx-control`. */
export type DevnxControlPaths = {
  root: string
  connectionFile: string
  runtimeFile: string
  claudeHome: string
  codexRoot: string
  codexUnavailableHome: string
  geminiRoot: string
  geminiUnavailableHome: string
  geminiBinRoot: string
}

export function getDevnxControlPaths(userDataPath: string): DevnxControlPaths {
  const root = join(userDataPath, 'devnx-control')
  const codexRoot = join(root, 'codex')
  const geminiRoot = join(root, 'gemini')
  return {
    root,
    connectionFile: join(root, 'connection.json'),
    runtimeFile: join(root, 'runtime.json'),
    claudeHome: join(root, 'claude'),
    codexRoot,
    codexUnavailableHome: join(codexRoot, 'unavailable'),
    geminiRoot,
    geminiUnavailableHome: join(geminiRoot, 'unavailable'),
    geminiBinRoot: join(geminiRoot, 'bin')
  }
}

// Why hashed: the account id comes from the panel and must never shape a path by itself.
export function accountDirName(accountId: string): string {
  return createHash('sha256').update(accountId).digest('hex').slice(0, 32)
}

export function codexAccountHome(paths: DevnxControlPaths, accountId: string): string {
  return join(paths.codexRoot, 'accounts', accountDirName(accountId))
}

export function geminiAccountHome(paths: DevnxControlPaths, accountId: string): string {
  return join(paths.geminiRoot, 'accounts', accountDirName(accountId))
}

export function geminiShimDir(paths: DevnxControlPaths, accountId: string | null): string {
  return join(paths.geminiBinRoot, accountId ? accountDirName(accountId) : 'unavailable')
}
