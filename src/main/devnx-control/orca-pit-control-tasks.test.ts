import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Repo } from '../../shared/repo-types'
import { requestDevnxControl } from './devnx-control-http'
import {
  devnxTasksPath,
  getDevnxTask,
  listDevnxTasks,
  parseDevnxProjects,
  parseDevnxTask,
  safeWebUrl,
  type DevnxControlReader
} from './orca-pit-control-tasks'
import { listDevnxProjectsForRepo } from './orca-pit-control-projects'

// Shapes as the Control returns them (contract routes 2-4, "formatos reais").
const TASK = {
  id: 311,
  title: 'Relatório do SAC',
  status: 'in_progress',
  priority: 'high',
  assignee: { id: 7, name: 'Fulano' },
  assignees: [
    { id: 7, name: 'Fulano' },
    { id: 9, name: 'Beltrana' }
  ],
  requested_by: { id: 2, name: 'Fabio' },
  execution_target: null,
  project_id: 24,
  tenant: { id: 1, name: 'DEVNX' },
  due_date: '2026-11-03',
  url: 'https://control.devnx.com.br/tarefas/311'
}

function reader(payloads: Record<string, unknown>): DevnxControlReader & { paths: string[] } {
  const paths: string[] = []
  return {
    paths,
    getJson: async (path: string) => {
      paths.push(path)
      return payloads[path.split('?')[0]]
    }
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('DevNX Control task mapping', () => {
  it('maps the contract task to the renderer shape', () => {
    expect(parseDevnxTask(TASK)).toEqual({
      id: 311,
      title: 'Relatório do SAC',
      status: 'in_progress',
      priority: 'high',
      assignee: { id: 7, name: 'Fulano' },
      assignees: [
        { id: 7, name: 'Fulano' },
        { id: 9, name: 'Beltrana' }
      ],
      dueDate: '2026-11-03',
      url: 'https://control.devnx.com.br/tarefas/311',
      projectId: 24,
      tenant: { id: 1, name: 'DEVNX' }
    })
  })

  it('drops malformed rows and unsafe links instead of guessing', () => {
    expect(parseDevnxTask({ ...TASK, id: 'abc' })).toBeNull()
    expect(parseDevnxTask({ ...TASK, title: '  ' })).toBeNull()
    const unsafe = parseDevnxTask({ ...TASK, url: 'javascript:alert(1)', assignee: null })
    expect(unsafe?.url).toBeNull()
    expect(unsafe?.assignee).toEqual({ id: 7, name: 'Fulano' })
    expect(safeWebUrl('https://user:pw@control.example/x')).toBeNull()
  })

  it('maps projects with their repository URLs and rejects a wrong envelope', () => {
    expect(
      parseDevnxProjects({
        projects: [
          {
            id: 24,
            name: 'SouLog',
            client: 'Cliente',
            status: 'active',
            tenant: { id: 2, name: 'Zabott LTDA' },
            repositories: ['git@x:a/b']
          },
          { id: 0, name: 'inválido' }
        ]
      })
    ).toEqual([
      {
        id: 24,
        name: 'SouLog',
        client: 'Cliente',
        status: 'active',
        tenant: { id: 2, name: 'Zabott LTDA' },
        repositories: ['git@x:a/b']
      }
    ])
    expect(() => parseDevnxProjects({ data: [] })).toThrow(/projetos/)
  })

  it('builds the task query with open statuses, assignee=me and a capped limit', () => {
    const path = devnxTasksPath({
      projectId: 24,
      search: '  sac ',
      statuses: ['pending', 'in_progress', 'review', 'blocked', 'bad;status'],
      mine: true,
      limit: 999
    })
    const url = new URL(path, 'https://x.invalid')
    expect(url.pathname).toBe('/api/orca/projects/24/tasks')
    expect(url.searchParams.get('status')).toBe('pending,in_progress,review,blocked')
    expect(url.searchParams.get('assignee')).toBe('me')
    expect(url.searchParams.get('limit')).toBe('200')
    expect(url.searchParams.get('search')).toBe('sac')
    expect(() => devnxTasksPath({ projectId: 0 })).toThrow()
  })

  it('reads tasks and one task detail through the session reader', async () => {
    const control = reader({
      '/api/orca/projects/24/tasks': { tasks: [TASK, { id: 2 }] },
      '/api/orca/tasks/311': { task: { ...TASK, description: '  Corrigir o filtro.  ' } }
    })
    const tasks = await listDevnxTasks(control, { projectId: 24 })
    expect(tasks.map((task) => task.id)).toEqual([311])
    const detail = await getDevnxTask(control, 311)
    expect(detail.description).toBe('Corrigir o filtro.')
    await expect(getDevnxTask(control, -1)).rejects.toThrow(/inválida/)
  })

  it('sends the session token to the panel route over mocked HTTP', async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ tasks: [TASK] }), { status: 200 })
    )
    vi.stubGlobal('fetch', fetchMock)
    const control: DevnxControlReader = {
      getJson: (path) =>
        requestDevnxControl('https://control.example/api', path, { token: 'device-token' })
    }
    const tasks = await listDevnxTasks(control, { projectId: 24, mine: true })
    expect(tasks).toHaveLength(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://control.example/api/orca/projects/24/tasks?assignee=me')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer device-token')
  })
})

describe('Control projects for a repo', () => {
  const repo = {
    id: 'repo-1',
    path: '/home/me/src/soulog',
    displayName: 'soulog'
  } as Repo

  it('suggests the project sharing a git remote', async () => {
    const control = reader({
      '/api/orca/projects': {
        projects: [
          { id: 1, name: 'Outro', repositories: [] },
          { id: 24, name: 'Logística', repositories: ['git@github.com:devnx/soulog.git'] }
        ]
      }
    })
    const list = await listDevnxProjectsForRepo(control, repo, {
      readRemotes: async () => ['https://github.com/devnx/soulog']
    })
    expect(list.suggestedProjectId).toBe(24)
    expect(list.suggestionReason).toBe('remote')
  })

  it('lists without a suggestion when no repo is given', async () => {
    const control = reader({ '/api/orca/projects': { projects: [{ id: 1, name: 'Um' }] } })
    const list = await listDevnxProjectsForRepo(control, null, { search: 'um' })
    expect(list).toEqual({
      projects: [{ id: 1, name: 'Um', client: null, status: null, tenant: null, repositories: [] }],
      suggestedProjectId: null,
      suggestionReason: null
    })
    expect(control.paths).toEqual(['/api/orca/projects?search=um'])
  })
})
