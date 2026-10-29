export type RuntimeAccessGrant = {
  deviceId: string
  name: string
  createdAt: number
  lastSeenAt: number | null
  // Orca-Pit: the DevNX Control person who signed in through the browser login.
  orcaPitUser?: { name: string; email: string; orcaRole: 'admin' | 'member' }
}
