// Orca-Pit: who a request came from when many people share one central Orca. The person is a
// DevNX Control user; the contract with the Control lives in the /api/orca routes.

export type OrcaPitUser = {
  id: number
  name: string
  email: string
  tenantId: number
  orcaRole: 'admin' | 'member'
}
