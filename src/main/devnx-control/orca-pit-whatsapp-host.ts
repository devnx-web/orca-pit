// Orca-Pit: what the WhatsApp RPC and the wake route need from the desktop, set by the bridge's
// install. A port, so the runtime (also run headless, without Electron) reaches none of it: with
// no desktop there is no approved machine, no bridge and nothing to wake.
import type { WhatsappBridgeState } from './orca-pit-whatsapp-state'

export type OrcaPitWhatsappHost = {
  /** The JWT of the person signed in to this app, or null. */
  personToken: () => string | null
  /** This machine in the company directory, once approved. */
  approvedMachine: () => { id: number; name: string } | null
  state: WhatsappBridgeState
  /** Reads the inbox now. */
  wake: () => void
}

let host: OrcaPitWhatsappHost | null = null

export function setOrcaPitWhatsappHost(next: OrcaPitWhatsappHost | null): void {
  host = next
}

export function orcaPitWhatsappHost(): OrcaPitWhatsappHost | null {
  return host
}
