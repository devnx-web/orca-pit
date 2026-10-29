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
}
