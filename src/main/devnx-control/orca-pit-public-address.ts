// Orca-Pit: the address other devices reach this machine at, kept per machine so "Share this
// computer" opens on it (`wss://orca.devnx.com.br` on the central, `wss://nitro5.devnx.com.br`
// on the Nitro5) instead of asking every time.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { parseServerShareAddress } from '../../shared/network/server-share-address'

export function readOrcaPitPublicAddress(filePath: string): string | null {
  try {
    const value: unknown = JSON.parse(readFileSync(filePath, 'utf8'))
    const address =
      typeof value === 'object' && value !== null ? (value as { address?: unknown }).address : null
    if (typeof address !== 'string') {
      return null
    }
    const parsed = parseServerShareAddress(address)
    return parsed.ok ? parsed.value : null
  } catch {
    return null
  }
}

/** Saves a valid address, or clears it with null/blank. Returns what is stored now. */
export function writeOrcaPitPublicAddress(filePath: string, address: string | null): string | null {
  const trimmed = address?.trim() ?? ''
  const parsed = trimmed ? parseServerShareAddress(trimmed) : null
  if (parsed && !parsed.ok) {
    throw new Error('Endereço inválido. Use um host, host:porta ou uma URL ws(s)://.')
  }
  const value = parsed?.ok ? parsed.value : null
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, `${JSON.stringify({ address: value })}\n`, { mode: 0o600 })
  return value
}
