// Orca-Pit: who a request came from when many people share one central Orca. The person is a
// DevNX Control user; the contract with the Control lives in the /api/orca routes.

export type OrcaPitUser = {
  id: number
  name: string
  email: string
  /** The first company shared with the central's owner, preferring the owner's default. */
  tenantId: number
  /** Every company shared with the central's owner ("Todas as empresas" in the Control). */
  tenantIds: number[]
  /** Admin when the person administers any of the shared companies. */
  orcaRole: 'admin' | 'member'
  /** The Control profile photo (absolute http(s) URL); absent on rows stored before pit12. */
  avatarUrl?: string | null
}

const MAX_AVATAR_URL_CHARS = 2048

/** Only an http(s) URL of sane length is shown as a photo; anything else is no photo. */
export function parseOrcaPitAvatarUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > MAX_AVATAR_URL_CHARS) {
    return null
  }
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}
