// Orca-Pit: the addresses a client on the same network reaches this machine at, sent with each
// heartbeat so the directory can offer them as a fallback when the internet route is down.
import { networkInterfaces, type NetworkInterfaceInfo } from 'node:os'

function isPrivateIPv4(address: string): boolean {
  const [a, b] = address.split('.').map(Number)
  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    // Tailscale's CGNAT range: a laptop on the tailnet is "local" too.
    (a === 100 && b >= 64 && b <= 127)
  )
}

function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '::1' || host.startsWith('127.')
}

/** `ws://<ip>:<port>` for each private IPv4, or none while the server listens on loopback only. */
export function orcaPitLanEndpoints(
  binding: { host: string; port: number } | null,
  interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()
): string[] {
  if (!binding || isLoopbackHost(binding.host)) {
    return []
  }
  const wildcard = binding.host === '0.0.0.0' || binding.host === '::'
  const addresses = Object.values(interfaces)
    .flat()
    .filter(
      (entry): entry is NetworkInterfaceInfo =>
        entry !== undefined &&
        entry.family === 'IPv4' &&
        !entry.internal &&
        isPrivateIPv4(entry.address) &&
        (wildcard || entry.address === binding.host)
    )
    .map((entry) => `ws://${entry.address}:${binding.port}`)
  return [...new Set(addresses)].sort()
}
