// Orca-Pit: criar um chat numa worktree de outro computador abria também um shell puro do host.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInitialTerminalSeeder } from './initial-terminal-seeder'
import { ENV, WT, makeSnapshot } from '../web-session-tabs-sync-test-harness'
import { holdEmptyWorkspaceDefaultSurfaceForLaunch } from '@/lib/empty-workspace-default-surface-claims'
import {
  forgetUnlistedCreatedChat,
  recordUnlistedCreatedChat
} from '@/lib/structured-agent-session-unlisted-created-chats'

const mocks = vi.hoisted(() => ({
  launchInWorktree: vi.fn((_worktreeId: string) => false),
  dispatch: vi.fn(async (_environmentId: string, _worktreeId: string) => true)
}))

vi.mock('../../store', () => ({
  // Uma worktree recém-criada: nenhuma linha de terminal guardada aqui.
  useAppStore: { getState: () => ({ tabsByWorktree: {} }) }
}))
vi.mock('@/lib/structured-agent-session-launch-status', () => ({
  hasStructuredAgentLaunchInWorktree: mocks.launchInWorktree
}))
vi.mock('../web-runtime-initial-terminal-bootstrap-dispatch', () => ({
  dispatchWebRuntimeInitialTerminalBootstrap: mocks.dispatch
}))

// A primeira resposta do host, montada antes de o chat existir lá: worktree vazia.
const emptyFirstAnswer = { type: 'snapshot' as const, ...makeSnapshot([]) }

async function seedsOnFirstAnswer(): Promise<boolean> {
  const seeder = createInitialTerminalSeeder(ENV, WT)
  if (!seeder.decide(emptyFirstAnswer, true)) {
    return false
  }
  await seeder.seed()
  return mocks.dispatch.mock.calls.length > 0
}

afterEach(() => {
  vi.clearAllMocks()
  mocks.launchInWorktree.mockReturnValue(false)
})

describe('semeador do terminal inicial remoto com chat nascendo', () => {
  it('ainda semeia o shell de uma worktree remota vazia aberta sem chat', async () => {
    await expect(seedsOnFirstAnswer()).resolves.toBe(true)
    expect(mocks.dispatch).toHaveBeenCalledWith(ENV, WT)
  })

  it('não semeia enquanto o host ainda decide se aceita o chat', async () => {
    const release = holdEmptyWorkspaceDefaultSurfaceForLaunch(WT)
    try {
      await expect(seedsOnFirstAnswer()).resolves.toBe(false)
    } finally {
      release()
    }
    expect(mocks.dispatch).not.toHaveBeenCalled()
  })

  it('não semeia enquanto o chat está sendo criado no host', async () => {
    mocks.launchInWorktree.mockImplementation((worktreeId) => worktreeId === WT)
    await expect(seedsOnFirstAnswer()).resolves.toBe(false)
    expect(mocks.dispatch).not.toHaveBeenCalled()
  })

  it('não semeia com o chat criado que a lista do host ainda não mostrou', async () => {
    recordUnlistedCreatedChat(WT, 'session-1', 'runtime:nitro5')
    try {
      await expect(seedsOnFirstAnswer()).resolves.toBe(false)
    } finally {
      forgetUnlistedCreatedChat(WT, 'session-1')
    }
    expect(mocks.dispatch).not.toHaveBeenCalled()
  })

  it('um chat de outra worktree não segura o shell desta', async () => {
    recordUnlistedCreatedChat(`${WT}-outra`, 'session-2', 'runtime:nitro5')
    const release = holdEmptyWorkspaceDefaultSurfaceForLaunch(`${WT}-outra`)
    try {
      await expect(seedsOnFirstAnswer()).resolves.toBe(true)
    } finally {
      release()
      forgetUnlistedCreatedChat(`${WT}-outra`, 'session-2')
    }
  })
})
