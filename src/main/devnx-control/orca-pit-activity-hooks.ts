// Orca-Pit: the calls Orca's own files make into the activity diary. This module stays light
// (no Electron, no stores) so Orca's hot paths and their tests import nothing heavy; the
// capture behind it is installed when the app starts the diary.
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { RpcCallerIdentity } from '../runtime/rpc/rpc-caller-identity'
import type { OrcaPitAgentAuthors } from '../../shared/orca-pit-agent-authors'

export type OrcaPitRpcContext = { runtime: OrcaRuntimeService; caller?: RpcCallerIdentity }

export type OrcaPitMultiplexConnection = object & { runtime: OrcaRuntimeService }

export type OrcaPitActivityCapture = {
  recordsRpc(method: string): boolean
  rpc(
    method: string,
    params: Record<string, unknown>,
    context: OrcaPitRpcContext,
    result: unknown
  ): void
  streamInput(
    caller: RpcCallerIdentity | undefined,
    runtime: OrcaRuntimeService,
    stream: { ptyId: string; terminal: string },
    text: string
  ): void
  desktopInput(runtime: OrcaRuntimeService, ptyId: string, data: string): void
  workspaceCreated(worktreeId: string): void
  login(deviceId: string): void
  authors(): OrcaPitAgentAuthors
}

let capture: OrcaPitActivityCapture | null = null

export function installOrcaPitActivityCapture(next: OrcaPitActivityCapture | null): void {
  capture = next
}

function guarded(run: (active: OrcaPitActivityCapture) => void): void {
  if (!capture) {
    return
  }
  try {
    run(capture)
  } catch (error) {
    console.warn('[orca-pit] activity hook failed:', error)
  }
}

/** Every successful unary RPC passes here; one lookup for methods the diary ignores. */
export function recordOrcaPitRpcActivity(
  method: string,
  params: unknown,
  context: OrcaPitRpcContext,
  result: unknown
): void {
  if (!capture?.recordsRpc(method) || typeof params !== 'object' || params === null) {
    return
  }
  const fields: Record<string, unknown> = { ...params }
  guarded((active) => active.rpc(method, fields, context, result))
}

// Why a WeakMap: a multiplex connection's state is Orca's type; the caller rides beside it.
const multiplexCallers = new WeakMap<object, RpcCallerIdentity | undefined>()

export function tagOrcaPitMultiplexCaller(
  connection: object,
  caller: RpcCallerIdentity | undefined
): void {
  multiplexCallers.set(connection, caller)
}

/** Keys a remote client (browser, paired desktop, phone) typed into a streamed terminal. */
export function observeOrcaPitStreamInput(
  connection: OrcaPitMultiplexConnection,
  stream: { ptyId: string; terminal: string },
  text: string
): void {
  guarded((active) =>
    active.streamInput(multiplexCallers.get(connection), connection.runtime, stream, text)
  )
}

/** Keys this computer's own window typed (pty:write): the central machine's owner. */
export function observeOrcaPitDesktopInput(
  runtime: OrcaRuntimeService | undefined,
  ptyId: string,
  data: string
): void {
  if (runtime) {
    guarded((active) => active.desktopInput(runtime, ptyId, data))
  }
}

export function recordOrcaPitDesktopWorkspaceCreated(worktreeId: string): void {
  guarded((active) => active.workspaceCreated(worktreeId))
}

/** A person signed in on this central Orca and got the paired device `deviceId`. */
export function recordOrcaPitLogin(deviceId: string): void {
  guarded((active) => active.login(deviceId))
}

/** Who sent the last command to each pane (paneKey → first name), for the sidebar rows. */
export function orcaPitAgentAuthors(): OrcaPitAgentAuthors {
  return capture?.authors() ?? {}
}
