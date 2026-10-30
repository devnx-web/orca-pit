// Orca-Pit: the approved machine's tunnel token and origin secret (contrato v1.2), kept in a 0600
// file so a machine that restarts while the Control is unreachable still comes back online. They
// never go to a log or to the renderer.
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { isRecord } from './devnx-control-http'

export type OrcaPitMachineSecrets = {
  tunnelToken: string
  originHost: string
  originSecret: string
}

export function readOrcaPitMachineSecrets(filePath: string): OrcaPitMachineSecrets | null {
  try {
    const value: unknown = JSON.parse(readFileSync(filePath, 'utf8'))
    if (!isRecord(value)) {
      return null
    }
    const { tunnelToken, originHost, originSecret } = value
    return typeof tunnelToken === 'string' &&
      tunnelToken &&
      typeof originHost === 'string' &&
      originHost &&
      typeof originSecret === 'string' &&
      originSecret
      ? { tunnelToken, originHost, originSecret }
      : null
  } catch {
    return null
  }
}

export function writeOrcaPitMachineSecrets(filePath: string, secrets: OrcaPitMachineSecrets): void {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, `${JSON.stringify(secrets)}\n`, { mode: 0o600 })
  chmodSync(filePath, 0o600)
}

export function clearOrcaPitMachineSecrets(filePath: string): void {
  rmSync(filePath, { force: true })
}
