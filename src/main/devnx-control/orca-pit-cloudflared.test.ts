import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OrcaPitTunnelState } from '../../shared/orca-pit-machines'
import { OrcaPitCloudflared, type OrcaPitTunnelProcess } from './orca-pit-cloudflared'
import {
  ensureOrcaPitCloudflared,
  orcaPitCloudflaredPath,
  sha256
} from './orca-pit-cloudflared-install'
import { orcaPitCloudflaredAsset } from './orca-pit-cloudflared-release'

class FakeTunnel extends EventEmitter implements OrcaPitTunnelProcess {
  readonly stderr = new PassThrough()
  killed: NodeJS.Signals | null = null
  kill(signal?: NodeJS.Signals): boolean {
    this.killed = signal ?? 'SIGTERM'
    return true
  }
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'orca-pit-cloudflared-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function setup() {
  const states: OrcaPitTunnelState[] = []
  const spawned: { binary: string; args: string[]; child: FakeTunnel }[] = []
  const timers: { callback: () => void; ms: number }[] = []
  let clock = 0
  const tunnel = new OrcaPitCloudflared({
    tokenFile: join(dir, 'token'),
    install: async () => '/bin/cloudflared-test',
    spawnTunnel: (binary, args) => {
      const child = new FakeTunnel()
      spawned.push({ binary, args, child })
      return child
    },
    onState: (state) => states.push(state),
    setTimer: (callback, ms) => {
      const timer = { callback, ms }
      timers.push(timer)
      return timer
    },
    clearTimer: (timer) => {
      timers.splice(timers.indexOf(timer as (typeof timers)[number]), 1)
    },
    now: () => clock
  })
  return { tunnel, states, spawned, timers, advance: (ms: number) => (clock += ms) }
}

describe('OrcaPitCloudflared', () => {
  it('runs the pinned binary with the token in a 0600 file and reports when it connects', async () => {
    const { tunnel, states, spawned } = setup()
    await tunnel.start('token-a')
    expect(spawned).toHaveLength(1)
    expect(spawned[0].args).toEqual([
      'tunnel',
      '--no-autoupdate',
      'run',
      '--token-file',
      join(dir, 'token')
    ])
    expect(readFileSync(join(dir, 'token'), 'utf8')).toBe('token-a')
    expect(statSync(join(dir, 'token')).mode & 0o777).toBe(0o600)
    spawned[0].child.stderr.write('INF Registered tunnel connection connIndex=0\n')
    await vi.waitFor(() => expect(states.at(-1)).toEqual({ kind: 'running' }))
  })

  it('restarts a dead tunnel with growing backoff, reset after a healthy minute', async () => {
    const { tunnel, spawned, timers, advance } = setup()
    await tunnel.start('token-a')
    spawned[0].child.emit('exit', 1)
    expect(timers.map((timer) => timer.ms)).toEqual([2_000])
    timers.shift()?.callback()
    await vi.waitFor(() => expect(spawned).toHaveLength(2))
    spawned[1].child.emit('exit', 1)
    expect(timers.map((timer) => timer.ms)).toEqual([4_000])
    timers.shift()?.callback()
    await vi.waitFor(() => expect(spawned).toHaveLength(3))
    advance(61_000)
    spawned[2].child.emit('exit', 1)
    expect(timers.map((timer) => timer.ms)).toEqual([2_000])
  })

  it('keeps one process per token and restarts only when the token changes', async () => {
    const { tunnel, spawned } = setup()
    await tunnel.start('token-a')
    await tunnel.start('token-a')
    expect(spawned).toHaveLength(1)
    await tunnel.start('token-b')
    expect(spawned[0].child.killed).toBe('SIGTERM')
    expect(spawned).toHaveLength(2)
    expect(readFileSync(join(dir, 'token'), 'utf8')).toBe('token-b')
  })

  it('stops cleanly: kills the process, cancels the retry, never restarts the old one', async () => {
    const { tunnel, spawned, timers, states } = setup()
    await tunnel.start('token-a')
    spawned[0].child.emit('exit', 1)
    expect(timers).toHaveLength(1)
    tunnel.stop()
    expect(timers).toHaveLength(0)
    expect(states.at(-1)).toEqual({ kind: 'off' })
    await tunnel.start('token-a')
    spawned[1].child.emit('exit', 0)
    tunnel.stop()
    spawned[1].child.emit('exit', 0)
    expect(spawned).toHaveLength(2)
  })
})

describe('ensureOrcaPitCloudflared', () => {
  const data = Buffer.from('cloudflared de teste')
  const asset = {
    asset: 'cloudflared-linux-amd64',
    assetSha256: sha256(data),
    binarySha256: sha256(data),
    archive: 'none' as const
  }

  it('pins a build for each platform the app ships on', () => {
    for (const [platform, arch] of [
      ['linux', 'x64'],
      ['linux', 'arm64'],
      ['win32', 'x64'],
      ['darwin', 'x64'],
      ['darwin', 'arm64']
    ] as const) {
      expect(orcaPitCloudflaredAsset(platform, arch)?.assetSha256).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it('installs a download that matches the hash, executable, and reuses it', async () => {
    const download = vi.fn(async () => data)
    const path = await ensureOrcaPitCloudflared({
      binDir: dir,
      platform: 'linux',
      arch: 'x64',
      asset,
      download
    })
    expect(path).toBe(orcaPitCloudflaredPath(dir, 'linux'))
    expect(statSync(path).mode & 0o111).not.toBe(0)
    await ensureOrcaPitCloudflared({ binDir: dir, platform: 'linux', arch: 'x64', asset, download })
    expect(download).toHaveBeenCalledTimes(1)
  })

  it('refuses a download with another hash and writes nothing', async () => {
    await expect(
      ensureOrcaPitCloudflared({
        binDir: dir,
        platform: 'linux',
        arch: 'x64',
        asset,
        download: async () => Buffer.from('outro binário')
      })
    ).rejects.toThrow(/hash/)
    expect(existsSync(orcaPitCloudflaredPath(dir, 'linux'))).toBe(false)
  })

  it('replaces a tampered binary on disk', async () => {
    writeFileSync(orcaPitCloudflaredPath(dir, 'linux'), 'adulterado')
    const download = vi.fn(async () => data)
    await ensureOrcaPitCloudflared({ binDir: dir, platform: 'linux', arch: 'x64', asset, download })
    expect(download).toHaveBeenCalledTimes(1)
    expect(readFileSync(orcaPitCloudflaredPath(dir, 'linux'))).toEqual(data)
  })
})
