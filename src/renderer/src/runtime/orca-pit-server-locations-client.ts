import type { OrcaPitServerLocations } from '../../../shared/orca-pit-server-locations'
import { callRuntimeRpc } from './runtime-rpc-client'

// Orca-Pit: a server without this method (older build) just shows no shortcuts.
export async function fetchOrcaPitServerLocations(
  environmentId: string
): Promise<OrcaPitServerLocations | null> {
  try {
    return await callRuntimeRpc<OrcaPitServerLocations>(
      { kind: 'environment', environmentId },
      'files.orcaPitServerLocations',
      undefined,
      { timeoutMs: 10_000 }
    )
  } catch {
    return null
  }
}
