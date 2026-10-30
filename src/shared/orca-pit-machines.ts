// Orca-Pit: the company's machine directory (contrato-maquinas v1). Each Orca-Pit signed in to the
// DevNX Control registers itself; the Control creates its Cloudflare tunnel once an admin approves
// it, and everyone reaches it at orca.devnx.com.br/<slug>.

export type OrcaPitMachineStatus = 'pending' | 'approved' | 'disabled'

export type OrcaPitMachine = {
  id: number
  tenant: { id: number; name: string }
  owner: { id: number; name: string; avatarUrl: string | null }
  name: string
  slug: string
  status: OrcaPitMachineStatus
  private: boolean
  platform: string | null
  version: string | null
  online: boolean
  lastSeenAt: string | null
  /** `wss://orca.devnx.com.br/<slug>`: what app and pairing connect to (the Control's `ws_url`). */
  publicUrl: string
  /** `https://orca.devnx.com.br/<slug>/`: the browser address (the Control's `public_url`). */
  webUrl: string | null
  /** `ws://<lan ip>:<port>`, for a client on the same network. */
  lanEndpoints: string[]
  isMine: boolean
  /** The viewer may approve, rename or remove it in the Control. */
  canManage: boolean
  /** The hidden tunnel host the router forwards to (contrato v1.2); only the owner needs it. */
  originHost: string | null
}

/** What this machine knows about its own entry and its tunnel. */
export type OrcaPitMachineSelfState =
  /** No person signed in to the app, or no Control session: nothing is registered. */
  | { kind: 'idle' }
  | { kind: 'registering' }
  | { kind: 'error'; message: string }
  | {
      kind: 'registered'
      machine: OrcaPitMachine
      tunnel: OrcaPitTunnelState
    }

export type OrcaPitTunnelState =
  | { kind: 'off' }
  | { kind: 'installing' }
  | { kind: 'starting' }
  | { kind: 'running' }
  | { kind: 'error'; message: string }

export type OrcaPitMachineListResult =
  | { ok: true; machines: OrcaPitMachine[] }
  | { ok: false; reason: 'signed-out' | 'unavailable'; message?: string }

// The Worker routes orca.devnx.com.br/<slug>; the Control picks the slug (decision 2).
export const ORCA_PIT_MACHINES_HOST = 'orca.devnx.com.br'

/** The https address a client signs in at, from the machine's public wss URL. */
export function orcaPitMachineHttpsUrl(publicUrl: string): string | null {
  try {
    const url = new URL(publicUrl)
    if (url.protocol !== 'wss:' && url.protocol !== 'https:') {
      return null
    }
    url.protocol = 'https:'
    return url.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

/** True when an access endpoint points at this machine's public address. */
export function isOrcaPitMachineEndpoint(endpoint: string, machine: OrcaPitMachine): boolean {
  const normalize = (value: string): string | null => {
    try {
      const url = new URL(value)
      const path = url.pathname.replace(/\/+$/, '')
      return `${url.host.toLowerCase()}${path.toLowerCase()}`
    } catch {
      return null
    }
  }
  const target = normalize(machine.publicUrl)
  return target !== null && normalize(endpoint) === target
}
