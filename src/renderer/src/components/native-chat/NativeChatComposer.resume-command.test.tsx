// @vitest-environment happy-dom

import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { NativeChatPickerItem } from './native-chat-picker-items'
import type { NativeChatStructuredComposerTransport } from './native-chat-composer-types'

type CommandItem = Extract<NativeChatPickerItem, { kind: 'command' }>

type FieldProps = {
  onSend?: () => void
  onChoosePickerItem?: (item: NativeChatPickerItem) => void
}
type KeyDownArgs = {
  completePickerItem: (item: NativeChatPickerItem) => void
  dispatchPickerCommand: (item: CommandItem) => void
}

type Mocks = {
  draft: string
  imageAttachments: { id: string; path: string }[]
  setDraft: Mock<(...args: unknown[]) => unknown>
  clearImageAttachments: Mock<(...args: unknown[]) => unknown>
  openHistory: Mock<(...args: unknown[]) => unknown>
  sendNativeChatMessage: Mock<(...args: unknown[]) => unknown>
  sendNativeChatTypedCommand: Mock<(...args: unknown[]) => unknown>
  fieldProps: FieldProps | null
  keyDownArgs: KeyDownArgs | null
}

const mocks = vi.hoisted((): Mocks => ({
  draft: '/resume',
  imageAttachments: [],
  setDraft: vi.fn(),
  clearImageAttachments: vi.fn(),
  openHistory: vi.fn(),
  sendNativeChatMessage: vi.fn(),
  sendNativeChatTypedCommand: vi.fn(),
  fieldProps: null,
  keyDownArgs: null
}))

vi.mock('../../store', () => {
  const state = {
    dictationState: 'idle',
    settings: { voice: { enabled: false }, nativeChatSessionOptions: {} },
    agentStatusByPaneKey: {},
    activeWorktreeId: 'wt-1',
    activeWorkspaceExecutionHostId: 'ssh:box',
    tabsByWorktree: { 'wt-1': [{ id: 'tab-1' }] },
    unifiedTabsByWorktree: {},
    updateSettings: vi.fn(),
    clearNativeChatLaunchDraft: vi.fn(),
    markNativeChatLaunchDraftAdopted: vi.fn()
  }
  const useAppStore = (selector: (value: typeof state) => unknown) => selector(state)
  useAppStore.getState = () => state
  return { useAppStore }
})
vi.mock('../right-sidebar/ai-vault-panel-workspace', () => ({
  selectAiVaultPanelWorkspace: () => ({ worktree: { id: 'wt-1' }, repo: null })
}))
vi.mock('../right-sidebar/agent-session-history-modal', () => ({
  openAgentSessionHistoryModal: (...args: unknown[]) => mocks.openHistory(...args)
}))
vi.mock('./native-chat-runtime-send', () => ({
  sendNativeChatMessage: (...args: unknown[]) => mocks.sendNativeChatMessage(...args),
  sendNativeChatTypedCommand: (...args: unknown[]) => mocks.sendNativeChatTypedCommand(...args)
}))
vi.mock('./use-native-chat-draft', () => ({
  useNativeChatDraft: () => ({
    draft: mocks.draft,
    setDraft: mocks.setDraft,
    flushDraftAppends: () => {}
  })
}))
vi.mock('./NativeChatComposerField', () => ({
  NativeChatComposerField: (props: FieldProps) => {
    mocks.fieldProps = props
    return null
  }
}))
vi.mock('./use-native-chat-skills', () => ({
  useNativeChatSkills: () => ({ status: 'ready', skills: [], error: null, retry: () => {} })
}))
vi.mock('./use-native-chat-composer-attachments', () => ({
  useNativeChatComposerAttachments: () => ({
    imageAttachments: mocks.imageAttachments,
    attachResolvedPaths: vi.fn(),
    clearImageAttachments: mocks.clearImageAttachments,
    flushPendingAttachments: vi.fn(),
    removeImageAttachment: vi.fn(),
    pendingChips: { begin: vi.fn(), resolve: vi.fn(), drop: vi.fn(), attachReferences: vi.fn() }
  })
}))
vi.mock('./use-native-chat-composer-keydown', () => ({
  useNativeChatComposerKeyDown: (args: KeyDownArgs) => {
    mocks.keyDownArgs = args
    return vi.fn()
  }
}))

import { NativeChatComposer } from './NativeChatComposer'

const RESUME: CommandItem = {
  kind: 'command',
  id: 'command:resume',
  name: 'resume',
  token: '/resume',
  skillCollision: false,
  orcaOwned: true
}

function renderStructuredChat() {
  const transport: NativeChatStructuredComposerTransport = {
    send: vi.fn(() => true),
    dispatchCommand: vi.fn(async () => ({ handled: false, accepted: false, error: null })),
    optionsSurface: {
      getSnapshot: () => [],
      setOption: vi.fn(),
      invokeAction: vi.fn(),
      subscribe: () => () => {}
    },
    optionSnapshot: [],
    onError: vi.fn(),
    runtime: 'local',
    sessionId: 'session-test',
    worktreeId: 'wt-structured',
    runtimeEnvironmentId: null
  }
  const chat = () => (
    <NativeChatComposer
      terminalTabId="tab-1"
      paneKey="tab-1:structured"
      targetPtyId={null}
      agent="claude"
      structuredTransport={transport}
    />
  )
  const view = render(chat())
  return { transport, rerender: () => view.rerender(chat()) }
}

describe('/resume in the native chat composer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.draft = '/resume'
    mocks.imageAttachments = []
    mocks.fieldProps = null
    mocks.keyDownArgs = null
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { git: { discoverCommitMessageModels: vi.fn(async () => ({ success: false })) } }
    })
  })
  afterEach(() => cleanup())

  it("opens a structured chat's history, typed in any case, and sends nothing", () => {
    mocks.draft = '/Resume  auth  retry'
    mocks.imageAttachments = [{ id: 'img-1', path: '/tmp/a.png' }]
    const { transport } = renderStructuredChat()

    act(() => mocks.fieldProps?.onSend?.())

    expect(mocks.openHistory).toHaveBeenCalledWith({
      workspace: { worktreeId: 'wt-structured' },
      initialQuery: 'auth retry'
    })
    expect(transport.send).not.toHaveBeenCalled()
    expect(transport.dispatchCommand).not.toHaveBeenCalled()
    expect(mocks.setDraft).toHaveBeenCalledWith('')
    // Attachments stay for the next real prompt.
    expect(mocks.clearImageAttachments).not.toHaveBeenCalled()

    cleanup()
    mocks.draft = '/res'
    renderStructuredChat()
    act(() => mocks.keyDownArgs?.dispatchPickerCommand(RESUME))
    expect(mocks.openHistory).toHaveBeenCalledTimes(2)
  })

  it('sends a picked skill named resume to the agent, as the skill it is', () => {
    mocks.draft = '/res'
    const { transport, rerender } = renderStructuredChat()
    act(() =>
      mocks.fieldProps?.onChoosePickerItem?.({
        kind: 'skill',
        id: 'skill:resume',
        name: 'resume',
        token: '/resume',
        description: null,
        sources: []
      })
    )
    mocks.draft = '/resume make it one page'
    rerender()

    act(() => mocks.fieldProps?.onSend?.())

    expect(mocks.openHistory).not.toHaveBeenCalled()
    expect(transport.dispatchCommand).toHaveBeenCalledWith('/resume make it one page')
  })

  // A terminal-backed chat (every SSH chat, for one) keeps the agent's own /resume.
  it('leaves /resume to the agent in a terminal-backed chat', () => {
    render(
      <NativeChatComposer
        terminalTabId="tab-1"
        paneKey="tab-1:leaf-1"
        targetPtyId="pty-1"
        agent="codex"
      />
    )

    act(() => mocks.fieldProps?.onSend?.())

    expect(mocks.openHistory).not.toHaveBeenCalled()
    expect(mocks.sendNativeChatTypedCommand).toHaveBeenCalledWith('pty-1', '/resume')
  })
})
