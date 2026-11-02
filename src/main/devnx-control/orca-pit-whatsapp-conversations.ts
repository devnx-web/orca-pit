// Orca-Pit: the WhatsApp chats on Orca's external-conversation seam (source `whatsapp`). This seam
// is our own, on whatever `experimentalConnectors` says, since it never talks to Orca's cloud. Its
// launcher differs from the connector's in one thing: the chat opens in view, as a normal tab of
// the project titled with the group's name (an agent never runs hidden here).
import { createHash } from 'node:crypto'
import type { AgentStatusHooksSettings } from '../../shared/agent-status-hooks-setting'
import { getRepoExecutionHostId } from '../../shared/execution-host'
import { isGitRepoKind } from '../../shared/repo-kind'
import type { Repo } from '../../shared/repo-types'
import type { AgentLaunchParams } from '../../shared/rpc-contract/agent-launch-params'
import { agentPaneWorkspace } from '../agent-hooks/agent-transition-detector'
import { executeAgentLaunch } from '../agent-launch/agent-launch-executor'
import { DeliveryReceipts } from '../external-conversations/external-conversation-delivery-receipts'
import type { ConversationWatchListener } from '../external-conversations/external-conversation-events'
import {
  findLink,
  type ExternalConversationLinkStore
} from '../external-conversations/external-conversation-links'
import {
  ExternalConversationSeam,
  type ExternalConversationHost
} from '../external-conversations/external-conversation-seam'
import type { ConversationLauncher } from '../external-conversations/external-conversation-start'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { resolveUnlaunchedIntent } from '../runtime/rpc/methods/agent-launch-intent-resolution'
import { agentLaunchSurfaceFactory } from '../runtime/rpc/methods/agent-launch-surfaces'
import { agentLaunchWorkspaceFactory } from '../runtime/rpc/methods/agent-launch-worktree-creation'
import type { WhatsappConversations, WhatsappInboxGroup } from './orca-pit-whatsapp-bridge'

export type WhatsappRepoStore = ExternalConversationLinkStore & {
  getRepos: () => readonly Repo[]
  getRepo: (id: string) => Repo | undefined
  getSettings: () => AgentStatusHooksSettings
}

/** The connector's launcher with the view kept: `presentation` absent reveals the new tab. */
function visibleConversationLauncher(runtime: OrcaRuntimeService): ConversationLauncher {
  const context = { runtime }
  return {
    launch: async ({ agent, target, prompt }, onSurfacePublished, signal) => {
      const { intent, decidedMode } = await resolveUnlaunchedIntent(
        { agent, target, prompt: { text: prompt, delivery: 'submit' } },
        runtime,
        null,
        { terminalOnly: true }
      )
      return executeAgentLaunch({
        runtime,
        intent,
        decidedMode,
        surfaces: agentLaunchSurfaceFactory(context, undefined, undefined, false, undefined, {
          early: null,
          presentation: undefined
        }),
        workspaces: agentLaunchWorkspaceFactory(context, agent),
        onSurfacePublished,
        signal
      })
    },
    paneWorkspace: async (worktreeId) => {
      const scope = await runtime.showTerminalWorkspaceLaunchScope(`id:${worktreeId}`)
      return agentPaneWorkspace(scope.id, scope.connectionId)
    }
  }
}

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
function launchTarget(
  repo: Repo,
  group: WhatsappInboxGroup,
  externalId: string
): AgentLaunchParams['target'] {
  if (!isGitRepoKind(repo)) {
    return { kind: 'existing', worktree: `path:${repo.path}` }
  }
  const hash = createHash('sha256').update(externalId).digest('hex').slice(0, 8)
  return {
    kind: 'create-worktree',
    create: {
      repo: `id:${repo.id}`,
      repoHostId: getRepoExecutionHostId(repo),
      name: `whatsapp-${hash}`,
      nameWasGenerated: true,
      displayName: group.name,
      displayNameKind: 'user'
    }
  }
}

export type WhatsappConversationsWithWatch = WhatsappConversations & {
  watch: (listener: ConversationWatchListener) => () => void
  dispose: () => void
}

export function createWhatsappConversations(
  runtime: OrcaRuntimeService,
  store: WhatsappRepoStore,
  chosenRepoId: (groupId: number) => string | undefined
): WhatsappConversationsWithWatch {
  const seam = new ExternalConversationSeam({
    store,
    readSettings: () => store.getSettings(),
    receipts: new DeliveryReceipts(() => runtime.getOrchestrationDb()),
    onWorkspaceRemoved: (listener) =>
      runtime.onWorktreeLifecycle((event) => {
        if (event.kind === 'removed') {
          listener(event.worktreeId)
        }
      }),
    sessionRows: runtime,
    onProviderSessionsChanged: (listener) =>
      runtime.subscribeAgentProviderSessionChangesFn?.(listener) ?? (() => {}),
    readHookRow: (paneKey) => runtime.agentTransitions.latestRow(paneKey),
    onAgentPaneChange: (listener) => runtime.agentTransitions.subscribe(listener)
  })
  const host: ExternalConversationHost = {
    launcher: visibleConversationLauncher(runtime),
    terminal: runtime
  }
  const repoOf = (group: WhatsappInboxGroup): Repo | null =>
    whatsappRepoFor(store.getRepos(), group, chosenRepoId(group.id))
  return {
    place: (group) => {
      const repo = repoOf(group)
      return repo ? { projectName: repo.devnxControlProject?.name || repo.displayName } : null
    },
    hasChat: (key) => findLink(store, key) !== null,
    start: async (key, deliveryId, group, prompt) => {
      const repo = repoOf(group)
      if (!repo) {
        return { outcome: 'refused', reason: 'agent_not_reachable' }
      }
      const { initial } = await seam.start(host, key, deliveryId, {
        agent: 'claude',
        target: launchTarget(repo, group, key.externalId),
        prompt
      })
      const paneKey = findLink(store, key)?.link.paneKey
      const handle = paneKey ? runtime.getTerminalHandleForPaneKey(paneKey) : null
      if (handle) {
        // The tab says which group it answers; the agent's own title would hide that.
        await runtime.renameTerminal(handle, group.name).catch((error: unknown) => {
          console.warn('[orca-pit] whatsapp: could not title the chat tab', error)
        })
      }
      return initial
    },
    send: (key, deliveryId, text) => seam.send(host, key, deliveryId, text),
    pendingPrompt: (key) => {
      try {
        return seam.pendingPrompt(host, key)
      } catch {
        return null
      }
    },
    answer: (key, promptId, optionId) => seam.answer(host, key, promptId, optionId),
    watch: (listener) => seam.watch(host, listener),
    dispose: () => seam.dispose('connectors_disabled')
  }
}
