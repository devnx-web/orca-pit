// Orca-Pit: which Control project an Orca project most likely is. The user still confirms it;
// this only pre-highlights one, first by a shared git remote, then by a similar name.
import type {
  DevnxControlProject,
  DevnxControlProjectSuggestionReason
} from './orca-pit-devnx-tasks'

/**
 * `host/owner/repo` in lower case for any form git accepts: scp-like ssh, ssh://, https, git://.
 * Credentials, ports, `www.` and a trailing `.git` do not take part in the comparison.
 */
export function normalizeGitRemoteUrl(input: string): string | null {
  const raw = input.trim()
  if (!raw) {
    return null
  }
  let host: string
  let path: string
  const scp = /^(?:[^@/\s]+@)?([^:/\s]+):(?!\/\/)(.+)$/.exec(raw)
  // Why length > 1: `C:/src/repo` is a Windows path, not an scp-like remote.
  if (scp && scp[1].length > 1 && !/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    host = scp[1]
    path = scp[2]
  } else {
    let url: URL
    try {
      url = new URL(raw)
    } catch {
      return null
    }
    if (!['https:', 'http:', 'ssh:', 'git:', 'git+ssh:', 'ssh+git:'].includes(url.protocol)) {
      return null
    }
    host = url.hostname
    path = decodeURIComponent(url.pathname)
  }
  const cleanHost = host.toLowerCase().replace(/^www\./, '')
  const cleanPath = path
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+/, '')
    .toLowerCase()
  if (!cleanHost || !cleanPath || !cleanPath.includes('/')) {
    return null
  }
  return `${cleanHost}/${cleanPath}`
}

/** Lower case, no accents, letters and digits only: "Sou-Log App" and "soulog_app" agree. */
export function normalizeProjectName(input: string): string {
  return input
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

function repositoryName(remote: string): string | null {
  const normalized = normalizeGitRemoteUrl(remote)
  return normalized ? (normalized.split('/').at(-1) ?? null) : null
}

// Why 4: shorter names ("app", "api") are contained in too many others to mean anything.
const MIN_CONTAINED_NAME_LENGTH = 4

function nameScore(projectName: string, candidates: readonly string[]): number {
  const project = normalizeProjectName(projectName)
  if (!project) {
    return 0
  }
  let best = 0
  for (const candidate of candidates) {
    if (!candidate) {
      continue
    }
    if (candidate === project) {
      return 2
    }
    const shorter = candidate.length < project.length ? candidate : project
    if (
      shorter.length >= MIN_CONTAINED_NAME_LENGTH &&
      (candidate.includes(project) || project.includes(candidate))
    ) {
      best = 1
    }
  }
  return best
}

export function suggestDevnxControlProject(
  projects: readonly DevnxControlProject[],
  repo: { remoteUrls: readonly string[]; names: readonly string[] }
): { projectId: number; reason: DevnxControlProjectSuggestionReason } | null {
  const remotes = new Set(
    repo.remoteUrls.map(normalizeGitRemoteUrl).filter((url): url is string => url !== null)
  )
  if (remotes.size > 0) {
    const byRemote = projects.find((project) =>
      project.repositories.some((url) => {
        const normalized = normalizeGitRemoteUrl(url)
        return normalized !== null && remotes.has(normalized)
      })
    )
    if (byRemote) {
      return { projectId: byRemote.id, reason: 'remote' }
    }
  }
  const candidates = [
    ...repo.names,
    ...repo.remoteUrls.map(repositoryName).filter((name): name is string => name !== null)
  ].map(normalizeProjectName)
  let best: { projectId: number; score: number; tied: boolean } | null = null
  for (const project of projects) {
    const score = nameScore(project.name, candidates)
    if (score === 0) {
      continue
    }
    if (!best || score > best.score) {
      best = { projectId: project.id, score, tied: false }
    } else if (score === best.score) {
      best.tied = true
    }
  }
  // A tie means the name alone cannot tell the projects apart; suggest nothing.
  return best && !best.tied ? { projectId: best.projectId, reason: 'name' } : null
}
