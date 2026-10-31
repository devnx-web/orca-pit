// Orca-Pit: what each hooked Orca action becomes in the diary. Installed behind the light
// hooks module (orca-pit-activity-hooks.ts) when the diary starts.
import {
  structuredAgentSessionPaneKey,
  structuredAgentSessionTabId
} from '../../shared/structured-agent-session-projection'
import { getStructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-registry'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import type { RpcCallerIdentity } from '../runtime/rpc/rpc-caller-identity'
import { isRecord } from './devnx-control-http'
import { actorForCaller } from './orca-pit-activity-context'
import { orcaPitUserForDevice } from './orca-pit-identity'
import type { OrcaPitPresenceAction } from './orca-pit-activity-types'
import type { OrcaPitActivityCapture, OrcaPitRpcContext } from './orca-pit-activity-hooks'
import { orcaPitActivity, type OrcaPitTerminalTarget } from './orca-pit-activity-recorder'

type TerminalRuntime = Pick<
  OrcaRuntimeService,
  | 'resolveLiveLeafForHandle'
  | 'wslMovePaneKeyForPty'
  | 'getTerminalHandleForPaneKey'
  | 'getTerminalWorktreeIdForHandle'
>

function targetForPty(
  runtime: TerminalRuntime,
  ptyId: string,
  handle?: string
): OrcaPitTerminalTarget {
  const paneKey = runtime.wslMovePaneKeyForPty(ptyId)
  const terminal = handle ?? (paneKey ? runtime.getTerminalHandleForPaneKey(paneKey) : null)
  return {
    paneKey,
    worktreeId: terminal ? runtime.getTerminalWorktreeIdForHandle(terminal) : null
  }
}

function ptyOfHandle(runtime: TerminalRuntime, handle: string): string | null {
  try {
    return runtime.resolveLiveLeafForHandle(handle)?.ptyId ?? null
  } catch {
    return null
  }
}

function textOfBlocks(body: unknown): string {
  if (!isRecord(body) || !Array.isArray(body.blocks)) {
    return ''
  }
  return body.blocks
    .map((block: unknown) => (isRecord(block) && typeof block.text === 'string' ? block.text : ''))
    .filter(Boolean)
    .join('\n')
}

function recordNativeChatMessage(
  context: OrcaPitRpcContext,
  sessionId: string,
  body: unknown
): void {
  const text = textOfBlocks(body)
  if (!text) {
    return
  }
  const conversation = getStructuredAgentSessionHost()?.deps.store.getConversation(sessionId)
  orcaPitActivity.recordAgentMessage({
    actor: actorForCaller(context.caller),
    text,
    paneKey: structuredAgentSessionPaneKey(structuredAgentSessionTabId(sessionId), sessionId),
    worktreeId: conversation?.location.workspaceId ?? null,
    sessionId,
    agent: conversation?.provider ?? null
  })
}

function sessionIdOf(params: Record<string, unknown>): string | null {
  return isRecord(params.envelope) && typeof params.envelope.sessionId === 'string'
    ? params.envelope.sessionId
    : null
}

type RpcRecorder = (
  params: Record<string, unknown>,
  context: OrcaPitRpcContext,
  result: unknown
) => void

const settingsChanged: RpcRecorder = (params, context) => {
  orcaPitActivity.recordSimple(
    'settings_changed',
    actorForCaller(context.caller),
    null,
    Object.keys(params).join(', ')
  )
}

const RPC_RECORDERS: Readonly<Record<string, RpcRecorder>> = {
  'terminal.send': (params, context, result) => {
    const accepted = isRecord(result) && isRecord(result.send) && result.send.accepted === true
    if (!accepted || params.inputKind === 'query-reply' || typeof params.terminal !== 'string') {
      return
    }
    const handle = params.terminal
    const text =
      (typeof params.text === 'string' ? params.text : '') + (params.enter === true ? '\r' : '')
    const ptyId = ptyOfHandle(context.runtime, handle)
    orcaPitActivity.observeTerminalInput(
      ptyId ?? `handle:${handle}`,
      text,
      () => actorForCaller(context.caller),
      () =>
        ptyId
          ? targetForPty(context.runtime, ptyId, handle)
          : { paneKey: null, worktreeId: context.runtime.getTerminalWorktreeIdForHandle(handle) }
    )
  },
  'agentSession.send': (params, context) => {
    const sessionId = sessionIdOf(params)
    if (sessionId) {
      recordNativeChatMessage(context, sessionId, params.body)
    }
  },
  'agentSession.create': (params, context) => {
    const sessionId = sessionIdOf(params)
    if (sessionId && isRecord(params.firstMessage)) {
      recordNativeChatMessage(context, sessionId, params.firstMessage.body)
    }
  },
  'worktree.create': (_params, context, result) => {
    const worktree = isRecord(result) && isRecord(result.worktree) ? result.worktree : null
    if (worktree && typeof worktree.id === 'string') {
      orcaPitActivity.recordSimple(
        'workspace_created',
        actorForCaller(context.caller),
        worktree.id,
        null
      )
    }
  },
  'settings.update': settingsChanged,
  'settings.mutateAgentLaunch': settingsChanged,
  'settings.updateTerminalQuickCommands': settingsChanged,
  'settings.updatePRBotAuthorOverride': settingsChanged,
  'settings.mutateNativeChatSessionOptions': settingsChanged
}

function streamInput(
  caller: RpcCallerIdentity | undefined,
  runtime: OrcaRuntimeService,
  stream: { ptyId: string; terminal: string },
  text: string
): void {
  orcaPitActivity.observeTerminalInput(
    stream.ptyId,
    text,
    () => actorForCaller(caller),
    () => targetForPty(runtime, stream.ptyId, stream.terminal)
  )
}

function desktopInput(runtime: OrcaRuntimeService, ptyId: string, data: string): void {
  orcaPitActivity.observeTerminalInput(
    ptyId,
    data,
    () => actorForCaller({ kind: 'desktop' }),
    () => targetForPty(runtime, ptyId)
  )
}

/** The capture minus what needs the agent tracker and Electron; orca-pit-activity adds those. */
const PRESENCE_ACTION = {
  start: 'presence_start',
  idle: 'presence_idle',
  resume: 'presence_resume',
  end: 'presence_end'
} as const satisfies Record<string, OrcaPitPresenceAction>

export const orcaPitActivityCapture: Omit<OrcaPitActivityCapture, 'starters' | 'presence'> = {
  recordsRpc: (method) => Object.hasOwn(RPC_RECORDERS, method),
  rpc: (method, params, context, result) => RPC_RECORDERS[method]?.(params, context, result),
  streamInput,
  desktopInput,
  workspaceCreated: (worktreeId) =>
    orcaPitActivity.recordSimple(
      'workspace_created',
      actorForCaller({ kind: 'desktop' }),
      worktreeId,
      null
    ),
  login: (deviceId) =>
    orcaPitActivity.recordSimple(
      'login',
      actorForCaller({ kind: 'paired-device', deviceId }),
      null,
      null
    ),
  // Only a browser that signed in with the Control has a person to clock; a link-paired device
  // gets no idle screen.
  clock: (caller, event, atMs) => {
    const user = caller?.kind === 'paired-device' ? orcaPitUserForDevice(caller.deviceId) : null
    if (!caller || !user) {
      return { person: null }
    }
    orcaPitActivity.recordPresence(PRESENCE_ACTION[event], actorForCaller(caller), atMs)
    // The photo comes from the sidebar's presence (key `u:<id>`), already safe for the page.
    return { person: { id: user.id, name: user.name, avatarUrl: null } }
  },
  authors: () => orcaPitActivity.authorsByPane()
}
