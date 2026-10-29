// Orca-Pit: the Control projects for the project-settings picker, with the one that most likely
// matches this Orca project pre-highlighted (same git remote first, then a similar name).
import { basename } from 'node:path'
import type { Repo } from '../../shared/repo-types'
import type { DevnxControlProjectList } from '../../shared/orca-pit-devnx-tasks'
import { suggestDevnxControlProject } from '../../shared/orca-pit-devnx-project-suggestion'
import { getRepoExecutionHostId } from '../../shared/execution-host'
import { isFolderRepo } from '../../shared/repo-kind'
import { parseGitRemoteFetchUrls } from '../../shared/git-remote-url-index'
import { runGitProbeOnHost } from '../repo-git-remote-identity'
import { listDevnxProjects, type DevnxControlReader } from './orca-pit-control-tasks'

export type RepoRemoteReader = (repo: Repo) => Promise<string[]>

/** Every fetch URL of the project's remotes; SSH/runtime repos fall back to the stored one. */
export const readRepoRemoteUrls: RepoRemoteReader = async (repo) => {
  const urls = new Set<string>()
  if (repo.gitRemoteIdentity?.remoteUrl) {
    urls.add(repo.gitRemoteIdentity.remoteUrl)
  }
  if (isFolderRepo(repo)) {
    return [...urls]
  }
  try {
    const result = await runGitProbeOnHost(
      ['remote', '-v'],
      repo.path,
      getRepoExecutionHostId(repo)
    )
    for (const url of parseGitRemoteFetchUrls(result?.stdout ?? '').values()) {
      urls.add(url)
    }
  } catch {
    // A missing checkout or hung mount only costs the suggestion, never the list.
  }
  return [...urls]
}

export async function listDevnxProjectsForRepo(
  reader: DevnxControlReader,
  repo: Repo | null | undefined,
  options: { search?: string; readRemotes?: RepoRemoteReader } = {}
): Promise<DevnxControlProjectList> {
  const projects = await listDevnxProjects(reader, options.search)
  if (!repo) {
    return { projects, suggestedProjectId: null, suggestionReason: null }
  }
  const remoteUrls = await (options.readRemotes ?? readRepoRemoteUrls)(repo)
  const suggestion = suggestDevnxControlProject(projects, {
    remoteUrls,
    names: [repo.displayName, basename(repo.path)]
  })
  return {
    projects,
    suggestedProjectId: suggestion?.projectId ?? null,
    suggestionReason: suggestion?.reason ?? null
  }
}
