import { readdir, readFile, realpath, statfs } from 'node:fs/promises'
import { homedir } from 'node:os'
import { posix } from 'node:path'
import type {
  OrcaPitServerLocation,
  OrcaPitServerLocations
} from '../../shared/orca-pit-server-locations'
import { listWindowsDrives } from '../runtime/windows-drive-listing'

// Pseudo, layered and image filesystems never hold a user's projects.
const NON_DATA_FS_TYPES = new Set([
  'autofs',
  'binfmt_misc',
  'bpf',
  'configfs',
  'debugfs',
  'devpts',
  'devtmpfs',
  'efivarfs',
  'fusectl',
  'hugetlbfs',
  'mqueue',
  'nsfs',
  'overlay',
  'proc',
  'pstore',
  'ramfs',
  'rpc_pipefs',
  'securityfs',
  'squashfs',
  'sysfs',
  'tmpfs',
  'tracefs'
])

// Removable and manually mounted disks live here even when the source is not /dev/* (NFS, SMB).
const DATA_MOUNT_PREFIXES = ['/media/', '/run/media/', '/mnt/']

// Operating-system mount points; /home is already reachable through the home chip.
const SYSTEM_MOUNT_PATTERNS = [
  /^\/$/,
  /^\/boot(\/|$)/,
  /^\/efi(\/|$)/,
  /^\/snap(\/|$)/,
  /^\/proc(\/|$)/,
  /^\/sys(\/|$)/,
  /^\/dev(\/|$)/,
  /^\/run(\/|$)/,
  /^\/var(\/|$)/,
  /^\/usr(\/|$)/,
  /^\/tmp(\/|$)/,
  /^\/home$/,
  /^\/root$/
]

export type OrcaPitMountEntry = { device: string; mountPoint: string; fsType: string }

// /proc/mounts escapes space, tab, newline and backslash as three-digit octal.
function unescapeMountField(value: string): string {
  return value.replace(/\\([0-7]{3})/g, (_match, octal: string) =>
    String.fromCharCode(Number.parseInt(octal, 8))
  )
}

function isUnderDataPrefix(mountPoint: string): boolean {
  return DATA_MOUNT_PREFIXES.some(
    (prefix) => mountPoint.startsWith(prefix) && mountPoint.length > prefix.length
  )
}

function isDataMount(entry: OrcaPitMountEntry): boolean {
  if (NON_DATA_FS_TYPES.has(entry.fsType) || entry.fsType.startsWith('cgroup')) {
    return false
  }
  if (isUnderDataPrefix(entry.mountPoint)) {
    return true
  }
  // Snap images are loop devices; any other /dev source outside system paths is a real disk.
  const isBlockDevice = entry.device.startsWith('/dev/') && !entry.device.startsWith('/dev/loop')
  return isBlockDevice && !SYSTEM_MOUNT_PATTERNS.some((pattern) => pattern.test(entry.mountPoint))
}

export function parseOrcaPitDataMounts(mountTable: string): OrcaPitMountEntry[] {
  const seenMountPoints = new Set<string>()
  const seenDevices = new Set<string>()
  const result: OrcaPitMountEntry[] = []
  for (const line of mountTable.split('\n')) {
    const [rawDevice, rawMountPoint, fsType] = line.trim().split(/\s+/)
    if (!rawDevice || !rawMountPoint || !fsType) {
      continue
    }
    const entry = {
      device: unescapeMountField(rawDevice),
      mountPoint: unescapeMountField(rawMountPoint),
      fsType
    }
    if (!isDataMount(entry) || seenMountPoints.has(entry.mountPoint)) {
      continue
    }
    // A disk bind-mounted twice shows once; network sources may share a name, so only /dev dedupes.
    if (entry.device.startsWith('/dev/') && seenDevices.has(entry.device)) {
      continue
    }
    seenMountPoints.add(entry.mountPoint)
    seenDevices.add(entry.device)
    result.push(entry)
  }
  return result.sort((left, right) => left.mountPoint.localeCompare(right.mountPoint))
}

const STATFS_TIMEOUT_MS = 2000

// A hung network mount must not hold the picker; unknown space just hides the hint.
async function freeBytesOf(path: string): Promise<number | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), STATFS_TIMEOUT_MS)
  })
  try {
    const probe = statfs(path).then(
      (stats) => Number(stats.bavail) * Number(stats.bsize),
      () => null
    )
    return await Promise.race([probe, timeout])
  } finally {
    clearTimeout(timer)
  }
}

async function diskLocation(path: string, name: string): Promise<OrcaPitServerLocation> {
  return { kind: 'disk', path, name, freeBytes: await freeBytesOf(path) }
}

async function linuxDisks(): Promise<OrcaPitServerLocation[]> {
  const mounts = parseOrcaPitDataMounts(await readFile('/proc/mounts', 'utf8'))
  return Promise.all(
    mounts.map((mount) => diskLocation(mount.mountPoint, posix.basename(mount.mountPoint)))
  )
}

async function macDisks(): Promise<OrcaPitServerLocation[]> {
  const names = await readdir('/Volumes')
  const volumes = await Promise.all(
    names.map(async (name) => {
      const path = posix.join('/Volumes', name)
      // The boot volume appears as a link to /, which the root chip already covers.
      const target = await realpath(path).catch(() => path)
      return target === '/' ? null : diskLocation(path, name)
    })
  )
  return volumes.filter((volume): volume is OrcaPitServerLocation => volume !== null)
}

async function windowsDisks(): Promise<OrcaPitServerLocation[]> {
  const drives = await listWindowsDrives()
  return Promise.all(
    drives.entries.map((drive) => diskLocation(drive.name, drive.name.slice(0, 2)))
  )
}

async function listDisks(platform: NodeJS.Platform): Promise<OrcaPitServerLocation[]> {
  try {
    if (platform === 'linux') {
      return await linuxDisks()
    }
    if (platform === 'darwin') {
      return await macDisks()
    }
    if (platform === 'win32') {
      return await windowsDisks()
    }
  } catch (error) {
    console.warn('[orca-pit-server-locations] Failed to list disks', error)
  }
  return []
}

export async function listOrcaPitServerLocations(
  platform: NodeJS.Platform = process.platform
): Promise<OrcaPitServerLocations> {
  const home = homedir()
  const disks = await listDisks(platform)
  return {
    pathFlavor: platform === 'win32' ? 'win32' : 'posix',
    locations: [
      { kind: 'home', path: home, name: posix.basename(home), freeBytes: null },
      // On Windows `/` is the drive-list request the folder browser already understands.
      { kind: 'root', path: '/', name: '/', freeBytes: null },
      ...disks
    ]
  }
}
