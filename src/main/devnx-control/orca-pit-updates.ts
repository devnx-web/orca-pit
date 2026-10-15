// Orca-Pit's updater. Stably's is off in this fork (see orca-pit-updater-gate), so the release
// script publishes releases.json beside the packages and this reads it: what is installed,
// what is newer, and installing the newest through the same install.sh people run by hand.
import { execFile, spawn } from 'node:child_process'
import { app } from 'electron'
import {
  ORCA_PIT_RELEASES_BASE_URL,
  type OrcaPitRelease,
  type OrcaPitUpdateCheck
} from '../../shared/devnx-control-types'

const MANIFEST_URL = `${ORCA_PIT_RELEASES_BASE_URL}/releases.json`
const MANIFEST_TIMEOUT_MS = 10_000
// Why this shape only: the version becomes part of the install URL run as root.
const RELEASE_VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)-pit(\d+)$/

function parseVersion(version: string): number[] | null {
  const match = RELEASE_VERSION_PATTERN.exec(version)
  return match ? match.slice(1).map(Number) : null
}

/** Positive when `a` is newer. A version outside the pattern sorts below every release. */
export function compareReleaseVersions(a: string, b: string): number {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (!left || !right) {
    return (left ? 1 : 0) - (right ? 1 : 0)
  }
  for (let index = 0; index < left.length; index++) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0)
    if (diff !== 0) {
      return diff
    }
  }
  return 0
}

export function parseReleasesManifest(raw: unknown): OrcaPitRelease[] {
  const releases =
    raw && typeof raw === 'object' ? (raw as { releases?: unknown }).releases : undefined
  if (!Array.isArray(releases)) {
    throw new Error('A lista de versões publicada está num formato desconhecido.')
  }
  return releases.flatMap((entry): OrcaPitRelease[] => {
    const release = (entry ?? {}) as Partial<OrcaPitRelease>
    if (typeof release.version !== 'string' || !parseVersion(release.version)) {
      return []
    }
    return [
      {
        version: release.version,
        date: typeof release.date === 'string' ? release.date : '',
        notes: Array.isArray(release.notes)
          ? release.notes.filter((note): note is string => typeof note === 'string')
          : [],
        active: release.active !== false
      }
    ]
  })
}

export function summarizeUpdate(
  installed: string,
  releases: readonly OrcaPitRelease[]
): OrcaPitUpdateCheck {
  const sorted = [...releases].sort((left, right) =>
    compareReleaseVersions(right.version, left.version)
  )
  const active = sorted.filter((release) => release.active)
  return {
    installed,
    latest: active[0]?.version ?? null,
    newer: active.filter((release) => compareReleaseVersions(release.version, installed) > 0),
    releases: sorted
  }
}

let installedRelease: Promise<string> | null = null
let resolvedRelease: string | null = null

/** The installed release once dpkg answered, for sync callers such as the About panel. */
export function getResolvedInstalledRelease(): string | null {
  return resolvedRelease
}

/** The .deb's own version (`1.4.214-pit4`); the app itself only knows Orca's `1.4.214`. */
export function getInstalledRelease(): Promise<string> {
  installedRelease ??= new Promise((resolve) => {
    if (!app.isPackaged || process.platform !== 'linux') {
      resolve(app.getVersion())
      return
    }
    execFile('dpkg-query', ['-W', '-f=${Version}', 'orca-ide'], (error, stdout) => {
      const version = stdout?.trim()
      resolvedRelease = !error && version ? version : app.getVersion()
      resolve(resolvedRelease)
    })
  })
  return installedRelease
}

async function fetchReleases(): Promise<OrcaPitRelease[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), MANIFEST_TIMEOUT_MS)
  try {
    // Why the timestamp: the CDN in front of the bucket must not answer with yesterday's list.
    const response = await fetch(`${MANIFEST_URL}?t=${Date.now()}`, {
      signal: controller.signal,
      cache: 'no-store'
    })
    if (!response.ok) {
      throw new Error(`O servidor de versões respondeu ${response.status}.`)
    }
    return parseReleasesManifest(await response.json())
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error('O servidor de versões não respondeu a tempo.')
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

export async function checkForUpdate(): Promise<OrcaPitUpdateCheck> {
  const [installed, releases] = await Promise.all([getInstalledRelease(), fetchReleases()])
  return summarizeUpdate(installed, releases)
}

function runAsRoot(command: string): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const child = spawn('pkexec', ['/bin/bash', '-c', command], { stdio: 'ignore' })
    child.once('error', reject)
    child.once('exit', (code) => resolve(code))
  })
}

/** Installs the newest active release and restarts into it; throws when it did not install. */
export async function installUpdate(): Promise<void> {
  if (!app.isPackaged || process.platform !== 'linux') {
    throw new Error('A atualização só funciona no Orca-Pit instalado pelo pacote .deb.')
  }
  const { latest, newer } = await checkForUpdate()
  if (!latest || newer.length === 0) {
    throw new Error('Você já está na versão mais nova.')
  }
  const command = `curl -fsSL ${ORCA_PIT_RELEASES_BASE_URL}/v${latest}/install.sh | bash`
  let code: number | null
  try {
    // Why pkexec: dpkg needs root, and it asks for the password in a desktop dialog.
    // Why pipefail: a failed download would otherwise feed bash nothing and exit 0.
    code = await runAsRoot(`set -o pipefail; ${command}`)
  } catch {
    throw new Error(`Não deu para pedir a senha de administrador. Rode no terminal: ${command}`)
  }
  // pkexec exits 126 when the password dialog is dismissed and 127 when it is refused.
  if (code === 126 || code === 127) {
    throw new Error('Instalação cancelada.')
  }
  if (code !== 0) {
    throw new Error(`A instalação falhou (código ${code}). Rode no terminal: sudo ${command}`)
  }
  app.relaunch()
  app.exit(0)
}
