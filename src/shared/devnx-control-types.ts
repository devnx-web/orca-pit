// DevNX Control: the team account broker (bcontrol) that picks the Claude,
// Codex and Antigravity session each terminal runs with.

export const DEVNX_CONTROL_PROVIDERS = ['claude', 'openai', 'gemini'] as const
export type DevnxControlProvider = (typeof DEVNX_CONTROL_PROVIDERS)[number]

export const DEVNX_CONTROL_DEFAULT_BASE_URL = 'https://bcontrol.devnx.com.br'

export type DevnxControlUsageWindow = {
  percent: number | null
  resetsAt: string | null
}

export type DevnxControlAccount = {
  id: string
  provider: DevnxControlProvider
  label: string
  plan: string | null
  status: string
  selected: boolean
  fiveHour: DevnxControlUsageWindow
  weekly: DevnxControlUsageWindow
}

export type DevnxControlStatus = {
  connected: boolean
  baseUrl: string
  selected: Partial<Record<DevnxControlProvider, DevnxControlAccount>>
  lastSyncAt: string | null
  warnings: string[]
}

export type DevnxControlConnectInput = {
  baseUrl?: string
  email: string
  password: string
}

export type DevnxControlResult<T> = { ok: true; value: T } | { ok: false; error: string }

export type DevnxControlApi = {
  getStatus: () => Promise<DevnxControlStatus>
  connect: (input: DevnxControlConnectInput) => Promise<DevnxControlResult<DevnxControlStatus>>
  logout: () => Promise<DevnxControlResult<DevnxControlStatus>>
  refresh: (options?: { syncUsage?: boolean }) => Promise<DevnxControlResult<DevnxControlStatus>>
  listAccounts: () => Promise<DevnxControlResult<DevnxControlAccount[]>>
  selectAccount: (
    provider: DevnxControlProvider,
    accountId: string
  ) => Promise<DevnxControlResult<DevnxControlStatus>>
}
