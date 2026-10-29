import { describe, expect, it } from 'vitest'
import { parseOrcaPitDataMounts } from './orca-pit-server-locations'

// Trimmed /proc/mounts from an Ubuntu laptop with a second NVMe data disk.
const PROC_MOUNTS = [
  'sysfs /sys sysfs rw,nosuid,nodev,noexec,relatime 0 0',
  'proc /proc proc rw,nosuid,nodev,noexec,relatime 0 0',
  'udev /dev devtmpfs rw,nosuid,relatime,size=8000000k 0 0',
  'tmpfs /run tmpfs rw,nosuid,nodev,noexec,relatime,size=1600000k,mode=755 0 0',
  '/dev/nvme0n1p2 / ext4 rw,relatime 0 0',
  'tmpfs /dev/shm tmpfs rw,nosuid,nodev 0 0',
  'cgroup2 /sys/fs/cgroup cgroup2 rw,nosuid,nodev,noexec,relatime 0 0',
  '/dev/loop0 /snap/core22/1380 squashfs ro,nodev,relatime 0 0',
  '/dev/loop1 /snap/firefox/4173 squashfs ro,nodev,relatime 0 0',
  '/dev/nvme0n1p1 /boot/efi vfat rw,relatime 0 0',
  'overlay /var/lib/docker/overlay2/abc/merged overlay rw,relatime 0 0',
  '/dev/nvme0n1p2 /var/snap/lxd/common/mntns ext4 rw 0 0',
  'tmpfs /run/user/1000 tmpfs rw,nosuid,nodev,relatime 0 0',
  'gvfsd-fuse /run/user/1000/gvfs fuse.gvfsd-fuse rw,nosuid,nodev 0 0',
  '/dev/nvme1n1p1 /media/prog/Dados ext4 rw,nosuid,nodev,relatime 0 0',
  '/dev/sda1 /run/media/prog/Pen\\040Drive vfat rw,nosuid,nodev 0 0',
  'nas:/backup /mnt/backup nfs4 rw,relatime 0 0',
  '/dev/sdb1 /srv/projetos xfs rw,relatime 0 0',
  '/dev/sdb1 /srv/projetos-bind xfs rw,relatime 0 0',
  '/dev/nvme0n1p3 /home ext4 rw,relatime 0 0',
  'tmpfs /mnt/ramdisk tmpfs rw 0 0',
  ''
].join('\n')

describe('parseOrcaPitDataMounts', () => {
  it('keeps data disks and drops system, snap, tmpfs and overlay mounts', () => {
    expect(parseOrcaPitDataMounts(PROC_MOUNTS).map((mount) => mount.mountPoint)).toEqual([
      '/media/prog/Dados',
      '/mnt/backup',
      '/run/media/prog/Pen Drive',
      '/srv/projetos'
    ])
  })

  it('unescapes octal sequences and keeps the device and type', () => {
    const pen = parseOrcaPitDataMounts(PROC_MOUNTS).find((mount) => mount.device === '/dev/sda1')
    expect(pen).toEqual({
      device: '/dev/sda1',
      mountPoint: '/run/media/prog/Pen Drive',
      fsType: 'vfat'
    })
  })

  it('keeps a disk mounted straight on /mnt and skips malformed lines', () => {
    const table = ['/dev/sdc1 /mnt ext4 rw 0 0', 'garbage', 'tmpfs /media tmpfs rw 0 0'].join('\n')
    expect(parseOrcaPitDataMounts(table).map((mount) => mount.mountPoint)).toEqual(['/mnt'])
  })

  it('returns nothing for a machine with only the system disk', () => {
    expect(
      parseOrcaPitDataMounts('/dev/sda2 / btrfs rw 0 0\n/dev/sda2 /var/log btrfs rw 0 0\n')
    ).toEqual([])
  })
})
