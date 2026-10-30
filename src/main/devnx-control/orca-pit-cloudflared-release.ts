// Orca-Pit: the one cloudflared build the app runs for its managed tunnel. Pinned version and
// hashes, so a compromised download never runs; a new version ships only with a new Orca-Pit.
// Hashes checked on 30/10/2026 against the release notes of cloudflare/cloudflared 2026.10.0
// (the macOS notes list the binary inside the .tgz, which `binarySha256` repeats).

export const ORCA_PIT_CLOUDFLARED_VERSION = '2026.10.0'

export type OrcaPitCloudflaredAsset = {
  asset: string
  /** sha256 of the downloaded file. */
  assetSha256: string
  /** sha256 of the runnable binary (the same file unless it comes in a .tgz). */
  binarySha256: string
  archive: 'none' | 'tgz'
}

const ASSETS: Record<string, OrcaPitCloudflaredAsset> = {
  'linux-x64': {
    asset: 'cloudflared-linux-amd64',
    assetSha256: 'd33ff2d14475178d2012c2c56beba87389ac5ded27649519f198a7d3134a99db',
    binarySha256: 'd33ff2d14475178d2012c2c56beba87389ac5ded27649519f198a7d3134a99db',
    archive: 'none'
  },
  'linux-arm64': {
    asset: 'cloudflared-linux-arm64',
    assetSha256: 'e6422b9d4f72d3194bc5a38676f13667c06666523217b842a877d72a80b5ac08',
    binarySha256: 'e6422b9d4f72d3194bc5a38676f13667c06666523217b842a877d72a80b5ac08',
    archive: 'none'
  },
  'win32-x64': {
    asset: 'cloudflared-windows-amd64.exe',
    assetSha256: '86aee4017b26625cee8484c113558f48effa4cd47f7aa05fcf425604e5d2b23c',
    binarySha256: '86aee4017b26625cee8484c113558f48effa4cd47f7aa05fcf425604e5d2b23c',
    archive: 'none'
  },
  'darwin-x64': {
    asset: 'cloudflared-darwin-amd64.tgz',
    assetSha256: '903845b81828c8cb3c5d13d816a2de71c06a3da5785469df8eb0e1b736d92f9f',
    binarySha256: '0560c9ab7281ac3f746055323623ed23bc0405b6dab9400474020cba33a978da',
    archive: 'tgz'
  },
  'darwin-arm64': {
    asset: 'cloudflared-darwin-arm64.tgz',
    assetSha256: 'a2f79ff7b9420aa537d74af239f376da170bbabeb529aec416002adac6a72e70',
    binarySha256: '72edfd3eea463aef4d5cb89e2e209cecb048cc756c2b01915de2e0ad7cb39830',
    archive: 'tgz'
  }
}

export function orcaPitCloudflaredAsset(
  platform: NodeJS.Platform,
  arch: string
): OrcaPitCloudflaredAsset | null {
  return ASSETS[`${platform}-${arch}`] ?? null
}

export function orcaPitCloudflaredDownloadUrl(asset: OrcaPitCloudflaredAsset): string {
  return `https://github.com/cloudflare/cloudflared/releases/download/${ORCA_PIT_CLOUDFLARED_VERSION}/${asset.asset}`
}
