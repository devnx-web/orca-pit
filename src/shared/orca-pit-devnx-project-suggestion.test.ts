import { describe, expect, it } from 'vitest'
import {
  normalizeGitRemoteUrl,
  normalizeProjectName,
  suggestDevnxControlProject
} from './orca-pit-devnx-project-suggestion'
import type { DevnxControlProject } from './orca-pit-devnx-tasks'

function project(id: number, name: string, repositories: string[] = []): DevnxControlProject {
  return { id, name, client: null, status: null, tenant: null, repositories }
}

describe('normalizeGitRemoteUrl', () => {
  it('reduces ssh and https forms of one repository to the same key', () => {
    const forms = [
      'git@github.com:DevNX/SouLog.git',
      'ssh://git@github.com/devnx/soulog.git',
      'ssh://git@github.com:22/devnx/soulog',
      'https://github.com/devnx/soulog',
      'https://token:x-oauth@github.com/DevNX/SouLog.git/',
      'https://www.github.com/devnx/soulog.git',
      'git://github.com/devnx/soulog.git'
    ]
    for (const form of forms) {
      expect(normalizeGitRemoteUrl(form)).toBe('github.com/devnx/soulog')
    }
  })

  it('keeps nested GitLab groups and self-hosted hosts', () => {
    expect(normalizeGitRemoteUrl('git@gitlab.devnx.com.br:time/apps/painel.git')).toBe(
      'gitlab.devnx.com.br/time/apps/painel'
    )
  })

  it('refuses what is not a remote', () => {
    expect(normalizeGitRemoteUrl('')).toBeNull()
    expect(normalizeGitRemoteUrl('C:/src/repo')).toBeNull()
    expect(normalizeGitRemoteUrl('https://github.com/only-owner')).toBeNull()
    expect(normalizeGitRemoteUrl('file:///home/me/repo.git')).toBeNull()
    expect(normalizeGitRemoteUrl('not a url')).toBeNull()
  })
})

describe('suggestDevnxControlProject', () => {
  const projects = [
    project(1, 'Painel Financeiro', ['https://github.com/devnx/financeiro.git']),
    project(24, 'SouLog', ['git@github.com:devnx/soulog.git']),
    project(30, 'App Logística')
  ]

  it('prefers a shared git remote over any name', () => {
    expect(
      suggestDevnxControlProject(projects, {
        remoteUrls: ['https://github.com/DevNX/SouLog'],
        names: ['App Logística']
      })
    ).toEqual({ projectId: 24, reason: 'remote' })
  })

  it('falls back to a similar name, accents and separators ignored', () => {
    expect(
      suggestDevnxControlProject(projects, {
        remoteUrls: ['git@github.com:outra/app-logistica.git'],
        names: []
      })
    ).toEqual({ projectId: 30, reason: 'name' })
    expect(normalizeProjectName('App Logística')).toBe('applogistica')
  })

  it('suggests nothing when names tie or nothing matches', () => {
    const tied = [project(5, 'Portal Cliente'), project(6, 'Portal Cliente')]
    expect(suggestDevnxControlProject(tied, { remoteUrls: [], names: ['portal-cliente'] })).toBe(
      null
    )
    expect(suggestDevnxControlProject(projects, { remoteUrls: [], names: ['api'] })).toBeNull()
  })

  it('accepts a contained name only when it is long enough to mean something', () => {
    expect(
      suggestDevnxControlProject([project(7, 'Financeiro')], {
        remoteUrls: [],
        names: ['financeiro-web']
      })
    ).toEqual({ projectId: 7, reason: 'name' })
    expect(
      suggestDevnxControlProject([project(8, 'App')], { remoteUrls: [], names: ['app-web'] })
    ).toBeNull()
  })
})
