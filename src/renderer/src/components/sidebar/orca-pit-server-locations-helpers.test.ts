import { describe, expect, it } from 'vitest'
import type { OrcaPitServerLocation } from '../../../../shared/orca-pit-server-locations'
import {
  findActiveOrcaPitLocation,
  formatOrcaPitFreeSpace
} from './orca-pit-server-locations-helpers'

describe('formatOrcaPitFreeSpace', () => {
  it('uses decimal units like df -H', () => {
    expect(formatOrcaPitFreeSpace(349_000_000_000)).toBe('349 GB')
    expect(formatOrcaPitFreeSpace(349_400_000_000)).toBe('349 GB')
    expect(formatOrcaPitFreeSpace(1_830_000_000_000)).toBe('1.8 TB')
    expect(formatOrcaPitFreeSpace(512_000_000)).toBe('512 MB')
    expect(formatOrcaPitFreeSpace(0)).toBe('0 KB')
  })

  it('rolls 999.6 GB over to the next unit', () => {
    expect(formatOrcaPitFreeSpace(999_600_000_000)).toBe('1 TB')
  })

  it('follows the UI locale for the decimal separator', () => {
    expect(formatOrcaPitFreeSpace(1_830_000_000_000, 'pt-BR')).toBe('1,8 TB')
  })
})

const posixLocations: OrcaPitServerLocation[] = [
  { kind: 'home', path: '/home/prog', name: 'prog', freeBytes: null },
  { kind: 'root', path: '/', name: '/', freeBytes: null },
  { kind: 'disk', path: '/media/prog/Dados', name: 'Dados', freeBytes: 1 }
]

const activePath = (path: string): string | undefined =>
  findActiveOrcaPitLocation(posixLocations, path, 'posix')?.path

describe('findActiveOrcaPitLocation', () => {
  it('highlights the innermost location holding the path', () => {
    expect(activePath('/home/prog')).toBe('/home/prog')
    expect(activePath('/home/prog/projetos/app')).toBe('/home/prog')
    expect(activePath('/media/prog/Dados')).toBe('/media/prog/Dados')
    expect(activePath('/media/prog/Dados/obras/')).toBe('/media/prog/Dados')
    expect(activePath('/etc')).toBe('/')
    expect(activePath('/')).toBe('/')
  })

  it('does not match a sibling that only shares a name prefix', () => {
    expect(activePath('/home/prog2')).toBe('/')
    expect(activePath('/media/prog/Dados-velho')).toBe('/')
  })

  it('returns nothing before the first listing resolves', () => {
    expect(findActiveOrcaPitLocation(posixLocations, '', 'posix')).toBeNull()
  })

  it('matches Windows drives case-insensitively and keeps / for the drive list', () => {
    const windows: OrcaPitServerLocation[] = [
      { kind: 'home', path: 'C:\\Users\\prog', name: 'prog', freeBytes: null },
      { kind: 'root', path: '/', name: '/', freeBytes: null },
      { kind: 'disk', path: 'C:\\', name: 'C:', freeBytes: 1 },
      { kind: 'disk', path: 'D:\\', name: 'D:', freeBytes: 1 }
    ]
    const active = (path: string): string | undefined =>
      findActiveOrcaPitLocation(windows, path, 'win32')?.path
    expect(active('/')).toBe('/')
    expect(active('d:\\Obras')).toBe('D:\\')
    expect(active('C:\\Users\\Prog\\app')).toBe('C:\\Users\\prog')
    expect(active('C:\\Windows')).toBe('C:\\')
  })
})
