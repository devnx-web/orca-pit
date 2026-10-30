// Orca-Pit: puts the pinned cloudflared in userData/bin. The download is checked against the
// pinned hash before it is written, and the binary again before every start.
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import {
  ORCA_PIT_CLOUDFLARED_VERSION,
  type OrcaPitCloudflaredAsset,
  orcaPitCloudflaredAsset,
  orcaPitCloudflaredDownloadUrl
} from './orca-pit-cloudflared-release'

export type OrcaPitCloudflaredInstallDeps = {
  binDir: string
  platform: NodeJS.Platform
  arch: string
  download?: (url: string) => Promise<Buffer>
  /** Unpacks a .tgz into a directory (macOS builds). */
  extractTgz?: (archive: string, destination: string) => Promise<void>
  /** Tests only: a stand-in for the pinned asset of this platform. */
  asset?: OrcaPitCloudflaredAsset
}

// Why 2 min: 40-55 MB over a slow office link.
const DOWNLOAD_TIMEOUT_MS = 120_000

export function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

async function fetchBinary(url: string): Promise<Buffer> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS)
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'follow' })
    if (!response.ok) {
      throw new Error(`O download do cloudflared respondeu ${response.status}.`)
    }
    return Buffer.from(await response.arrayBuffer())
  } finally {
    clearTimeout(timer)
  }
}

function untar(archive: string, destination: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('tar', ['-xzf', archive, '-C', destination], (error) =>
      error ? reject(error) : resolve()
    )
  })
}

export function orcaPitCloudflaredPath(binDir: string, platform: NodeJS.Platform): string {
  const name = `cloudflared-${ORCA_PIT_CLOUDFLARED_VERSION}`
  return join(binDir, platform === 'win32' ? `${name}.exe` : name)
}

/** Path of a verified cloudflared, downloading it the first time. */
export async function ensureOrcaPitCloudflared(
  deps: OrcaPitCloudflaredInstallDeps
): Promise<string> {
  const asset = deps.asset ?? orcaPitCloudflaredAsset(deps.platform, deps.arch)
  if (!asset) {
    throw new Error(`O cloudflared não tem versão para ${deps.platform}/${deps.arch}.`)
  }
  const target = orcaPitCloudflaredPath(deps.binDir, deps.platform)
  if (existsSync(target) && sha256(readFileSync(target)) === asset.binarySha256) {
    return target
  }
  mkdirSync(deps.binDir, { recursive: true })
  const data = await (deps.download ?? fetchBinary)(orcaPitCloudflaredDownloadUrl(asset))
  if (sha256(data) !== asset.assetSha256) {
    throw new Error('O cloudflared baixado não confere com o hash esperado; nada foi instalado.')
  }
  const staging = `${target}.download`
  rmSync(staging, { recursive: true, force: true })
  if (asset.archive === 'tgz') {
    mkdirSync(staging, { recursive: true })
    const archive = join(staging, asset.asset)
    writeFileSync(archive, data)
    await (deps.extractTgz ?? untar)(archive, staging)
    const binary = readFileSync(join(staging, 'cloudflared'))
    if (sha256(binary) !== asset.binarySha256) {
      rmSync(staging, { recursive: true, force: true })
      throw new Error('O cloudflared extraído não confere com o hash esperado; nada foi instalado.')
    }
    writeFileSync(`${target}.new`, binary)
    rmSync(staging, { recursive: true, force: true })
  } else {
    writeFileSync(`${target}.new`, data)
  }
  chmodSync(`${target}.new`, 0o755)
  renameSync(`${target}.new`, target)
  return target
}
