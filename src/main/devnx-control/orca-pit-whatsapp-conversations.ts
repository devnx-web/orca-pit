// Orca-Pit: the WhatsApp chats on this desktop's Orca chat host (`orca-pit-whatsapp-chats.ts`):
// where a group's chat runs (the Orca project linked to its Control project), its workspace (a
// worktree of its own, or the folder project) and how the chat is made: at rest with its opening
// message, its tab shown and focused. Groups whose chat was a terminal before keep their link in
// the workspace record that Orca's connector seam wrote; it is read here only to move them over.
import { createHash, randomUUID } from 'node:crypto'
import type { AgentStatusHooksSettings } from '../../shared/agent-status-hooks-setting'
import { getRepoExecutionHostId } from '../../shared/execution-host'
import { isGitRepoKind } from '../../shared/repo-kind'
import type { Repo } from '../../shared/repo-types'
import { createStructuredAgentSessionId } from '../../shared/structured-agent-session-create'
import { createStructuredAgentSessionOperationId } from '../../shared/structured-agent-session-mutation'
import { structuredAgentSessionSendBody } from '../../shared/structured-agent-session-send-mutation'
import { getStructuredAgentSessionHost } from '../native-chat/agent-session-wire/structured-agent-session-registry'
import {
  findLink,
  type ExternalConversationLinkStore
} from '../external-conversations/external-conversation-links'
import { hookReportedSession } from '../external-conversations/external-conversation-session-capture'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import {
  commitStructuredAgentSessionCreate,
  prepareStructuredAgentSessionCreateForWorktree,
  structuredAgentSessionCreateIntentFingerprint
} from '../runtime/rpc/methods/structured-agent-session-create'
import { resolveUncommittedStructuredCreate } from '../runtime/rpc/methods/structured-agent-session-precommit-refusal'
import { agentLaunchWorkspaceFactory } from '../runtime/rpc/methods/agent-launch-worktree-creation'
import type { WhatsappConversations } from './orca-pit-whatsapp-bridge'
import type {
  WhatsappChatKey,
  WhatsappChatListener,
  WhatsappInboxGroup
} from './orca-pit-whatsapp-chat-types'
import {
  WhatsappChats,
  type WhatsappChatCreate,
  type WhatsappChatCreated,
  type WhatsappChatHost
} from './orca-pit-whatsapp-chats'
import { WHATSAPP_CHAT_CALLER } from './orca-pit-whatsapp-chat-host'
import type { WhatsappBridgeState } from './orca-pit-whatsapp-state'

export type WhatsappRepoStore = ExternalConversationLinkStore & {
  getRepos: () => readonly Repo[]
  getRepo: (id: string) => Repo | undefined
  getSettings: () => AgentStatusHooksSettings
}

const AGENT = 'claude'
const CALLER = WHATSAPP_CHAT_CALLER

/** The Orca project of the group's Control project: the one chosen for it here, else the first. */
export function whatsappRepoFor(
  repos: readonly Repo[],
  group: WhatsappInboxGroup,
  chosenRepoId: string | undefined
): Repo | null {
  if (group.projectId === null) {
    return null
  }
  const linked = repos.filter((repo) => repo.devnxControlProject?.id === group.projectId)
  return linked.find((repo) => repo.id === chosenRepoId) ?? linked[0] ?? null
}

/** A worktree of its own per chat (folder projects run in the folder), named after the group. */
function worktreeCreate(repo: Repo, group: WhatsappInboxGroup, externalId: string) {
  const hash = createHash('sha256').update(externalId).digest('hex').slice(0, 8)
  return {
    repo: `id:${repo.id}`,
    repoHostId: getRepoExecutionHostId(repo),
    name: `whatsapp-${hash}`,
    nameWasGenerated: true,
    displayName: group.name,
    displayNameKind: 'user' as const
  }
}

/** Makes the chat as a "new chat" tab does: at rest, its opening message starting the agent. */
async function createChat(
  runtime: OrcaRuntimeService,
  input: WhatsappChatCreate
): Promise<WhatsappChatCreated> {
  const ensureHost = async () => {
    await runtime.ensureStructuredAgentSessionHost()
    const host = getStructuredAgentSessionHost()
    if (!host) {
      throw new Error('structured agent sessions are unavailable on this runtime')
    }
    return host
  }
  const intent = {
    envelope: {
      sessionId: input.sessionId,
      clientOperationId: input.operationId,
      expectedRuntimeFence: null,
      payloadFingerprint: ''
    },
    worktree: `id:${input.worktreeId}`,
    agent: AGENT,
    ...(input.resumeProviderSessionId
      ? { resumeFrom: { providerSessionId: input.resumeProviderSessionId } }
      : {}),
    firstMessage: {
      clientMessageId: input.openingMessageId,
      body: structuredAgentSessionSendBody(input.text, [])
    }
  } as const
  // An at-rest create's ledger row is keyed by its intent, so the same ids replay it.
  const envelope = {
    ...intent.envelope,
    payloadFingerprint: structuredAgentSessionCreateIntentFingerprint(intent)
  }
  const prepared = await resolveUncommittedStructuredCreate(() =>
    prepareStructuredAgentSessionCreateForWorktree({
      ...intent,
      runtime,
      ensureHost,
      envelope,
      caller: CALLER,
      atRest: true
    })
  )
  if ('refusal' in prepared) {
    return { ok: false, code: prepared.refusal.code, stage: 'prepare' }
  }
  const created = await commitStructuredAgentSessionCreate({
    runtime,
    caller: CALLER,
    prepared,
    activate: true
  })
  return created.ok ? { ok: true } : { ok: false, code: created.refusal.code, stage: 'commit' }
}

export type WhatsappConversationsWithWatch = WhatsappConversations & {
  watch: (listener: WhatsappChatListener) => () => void
  dispose: () => void
}

export function createWhatsappConversations(
  runtime: OrcaRuntimeService,
  store: WhatsappRepoStore,
  state: WhatsappBridgeState,
  log: (message: string, error?: unknown) => void
): WhatsappConversationsWithWatch {
  const repoOf = (group: WhatsappInboxGroup): Repo | null =>
    whatsappRepoFor(store.getRepos(), group, state.group(group.id).repoId)
  const workspaces = agentLaunchWorkspaceFactory({ runtime }, AGENT)
  const chats = new WhatsappChats({
    state,
    log,
    host: async () => {
      try {
        await runtime.ensureStructuredAgentSessionHost()
      } catch (error) {
        log('the chat host could not start', error)
        return null
      }
      // The registry's host is the one this runtime installed; the narrow type is what is used.
      const host: WhatsappChatHost | null = getStructuredAgentSessionHost()
      return host
    },
    chatSupported: async (group, worktreeId) => {
      const repo = repoOf(group)
      const selector = worktreeId ? `id:${worktreeId}` : repo ? `path:${repo.path}` : null
      if (!selector) {
        return null
      }
      try {
        const support = await runtime.getStructuredAgentSessionCreateSupport(selector, AGENT, {
          requireInstalledChatProgram: true
        })
        return support.supported
      } catch {
        return null
      }
    },
    openWorkspace: async (group, externalId, onCreated) => {
      const repo = repoOf(group)
      if (!repo) {
        return null
      }
      if (!isGitRepoKind(repo)) {
        return (await runtime.showTerminalWorkspaceLaunchScope(`path:${repo.path}`)).id
      }
      const created = await workspaces.createWorktree({
        create: worktreeCreate(repo, group, externalId),
        startupAgent: undefined,
        promisedAgentChat: true,
        onWorkspaceCreated: onCreated
      })
      return created.worktreeId
    },
    workspaceExists: async (worktreeId) => {
      try {
        await runtime.showTerminalWorkspaceLaunchScope(`id:${worktreeId}`)
        return true
      } catch {
        return false
      }
    },
    createChat: (input) => createChat(runtime, input),
    showTab: async (sessionId) => {
      const record = getStructuredAgentSessionHost()?.deps.store.getConversation(sessionId)
      if (record) {
        await runtime.publishStructuredAgentSessionTab({
          workspaceId: record.location.workspaceId,
          sessionId,
          agent: AGENT,
          activate: false
        })
      }
    },
    legacyChat: (key: WhatsappChatKey) => {
      const linked = findLink(store, key)
      // Only a local terminal chat moves over: a chat cannot run on a remote host.
      if (!linked || linked.workspace.sshHostId !== null) {
        return null
      }
      const providerSession =
        linked.link.providerSession ?? hookReportedSession(runtime, linked.link)?.providerSession
      return {
        worktreeId: linked.workspace.worktreeId,
        paneKey: linked.link.paneKey,
        providerSessionId: providerSession?.id ?? null
      }
    },
    stopLegacyTerminal: async (paneKey) => {
      const handle = runtime.getTerminalHandleForPaneKey(paneKey)
      if (handle) {
        await runtime.closeTerminal(handle).catch((error: unknown) => {
          log('could not close the old terminal chat', error)
        })
      }
    },
    mintOperationId: () => createStructuredAgentSessionOperationId(randomUUID),
    mintSessionId: () => createStructuredAgentSessionId(AGENT, randomUUID),
    sleep: (ms) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms).unref()
      })
  })
  return {
    place: (group) => {
      const repo = repoOf(group)
      return repo ? { projectName: repo.devnxControlProject?.name || repo.displayName } : null
    },
    hasChat: (key) => chats.hasChat(key),
    start: (key, _deliveryId, group, prompt) => chats.start(key, group, prompt),
    send: (key, deliveryId, text) => chats.send(key, deliveryId, text),
    openingHeld: (key) => chats.openingHeld(key),
    pendingPrompt: (key) => chats.pendingPrompt(key),
    answer: (key, promptId, optionId) => chats.answer(key, promptId, optionId),
    watch: (listener) => chats.watch(listener),
    dispose: () => chats.dispose()
  }
}
